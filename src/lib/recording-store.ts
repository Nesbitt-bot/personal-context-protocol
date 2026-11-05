/**
 * Server-side write path for agent recording.
 *
 * Shared by the agent message, compact, and ingest routes (and the legacy
 * scoped message route) so message-append, title normalization, and compaction
 * insertion live in one place. Invariants enforced here:
 *
 *   - messages are append-only with a monotonically increasing ordinal;
 *   - appends are idempotent for timestamped messages: a message whose role,
 *     content and provider_timestamp already exist in the session is not
 *     stored again (a sync client replaying from a stale cursor, e.g. the
 *     OpenCode session-manager after a crash, records nothing twice). The
 *     session row is locked so concurrent replays cannot both insert;
 *   - AI-suggested session titles are normalized and de-duplicated within the
 *     topic, and a rename event is recorded;
 *   - compactions are additional records and never replace raw messages;
 *   - topic ids are resolved internally and never surfaced to the agent.
 */

import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from './db';
import { messages, sessions, events, compactions } from './schema';
import { createId } from './auth';
import { generateUniqueTitle, normalizeTitle } from './naming';
import type { NormalizedCompact } from './ingest';

/** The transaction handle drizzle passes to `db.transaction(async (tx) => ...)`. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AppendInput {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'correction';
  content: string;
  provider?: string;
  base_model?: string;
  provider_timestamp?: string;
}

export type StoreFailureCode = 'NOT_FOUND' | 'SESSION_ARCHIVED' | 'FORBIDDEN';

export interface AppendSuccess {
  ok: true;
  /** One entry per input message; `duplicate` marks one that already existed. */
  messages: Array<{ id: string; ordinal: number; duplicate?: boolean }>;
  duplicates: number;
  session: { id: string; title: string; last_message_at: string };
}

/**
 * Normalize and de-duplicate an AI-suggested session title within its topic,
 * then apply it and record a rename event. Returns the stored title.
 */
async function applySuggestedSessionTitle(
  tx: Tx,
  sessionId: string,
  topicId: string | null,
  currentTitle: string,
  suggested: string,
  actor: string,
): Promise<string> {
  const normalized = normalizeTitle(suggested);
  if (!normalized || normalized === currentTitle) {
    return currentTitle;
  }

  // Siblings are sessions in the same group: the same topic, or the other
  // uncategorized sessions when this session has no topic.
  const sameGroup = topicId === null ? isNull(sessions.topicId) : eq(sessions.topicId, topicId);
  const siblings = await tx
    .select({ title: sessions.title })
    .from(sessions)
    .where(and(sameGroup, ne(sessions.id, sessionId)));

  const uniqueTitle = generateUniqueTitle(normalized, siblings.map((row) => row.title), normalized);
  if (uniqueTitle === currentTitle) {
    return currentTitle;
  }

  await tx.update(sessions).set({ title: uniqueTitle, updatedAt: new Date() }).where(eq(sessions.id, sessionId));
  await tx.insert(events).values({
    id: createId('evt'),
    sessionId,
    topicId,
    action: 'session.renamed',
    actor,
    detailsJson: { old_title: currentTitle, suggested_title: suggested, new_title: uniqueTitle },
    createdAt: new Date(),
  });

  return uniqueTitle;
}

/**
 * Append messages to a session. `canRenameSession` gates the suggested title.
 */
export async function appendMessagesToSession(params: {
  sessionId: string;
  messages: AppendInput[];
  suggestedTitle?: string;
  canRenameSession: boolean;
  actor: string;
}): Promise<AppendSuccess | { ok: false; code: StoreFailureCode }> {
  const { sessionId, messages: newMessages, suggestedTitle, canRenameSession, actor } = params;

  const [session] = await db
    .select({ archived: sessions.archived, topicId: sessions.topicId, title: sessions.title })
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) return { ok: false, code: 'NOT_FOUND' };
  if (session.archived) return { ok: false, code: 'SESSION_ARCHIVED' };
  if (suggestedTitle && !canRenameSession) return { ok: false, code: 'FORBIDDEN' };

  const now = new Date();

  const { inserted, finalTitle, duplicates } = await db.transaction(async (tx) => {
    // Serialize appends per session: ordinals and the duplicate check below.
    await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId)).for('update');
    const [maxOrdinal] = await tx
      .select({ max: sql<number>`max(${messages.ordinal})` })
      .from(messages)
      .where(eq(messages.sessionId, sessionId));

    let currentOrdinal = maxOrdinal?.max ? Number(maxOrdinal.max) : 0;
    const insertedRows: Array<{ id: string; ordinal: number; duplicate?: boolean }> = [];
    let duplicateCount = 0;
    let firstNewOrdinal: number | null = null;

    for (const msg of newMessages) {
      if (msg.provider_timestamp) {
        const [existing] = await tx
          .select({ id: messages.id, ordinal: messages.ordinal })
          .from(messages)
          .where(and(
            eq(messages.sessionId, sessionId),
            eq(messages.role, msg.role),
            eq(messages.providerTimestamp, new Date(msg.provider_timestamp)),
            eq(messages.content, msg.content),
          ))
          .limit(1);
        if (existing) {
          insertedRows.push({ id: existing.id, ordinal: existing.ordinal, duplicate: true });
          duplicateCount += 1;
          continue;
        }
      }
      currentOrdinal += 1;
      if (firstNewOrdinal === null) firstNewOrdinal = currentOrdinal;
      const messageId = createId('msg');
      await tx.insert(messages).values({
        id: messageId,
        sessionId,
        topicId: session.topicId,
        ordinal: currentOrdinal,
        role: msg.role,
        content: msg.content,
        contentType: 'markdown',
        provider: msg.provider || 'unknown',
        BaseModel: msg.base_model || 'unknown',
        providerTimestamp: msg.provider_timestamp ? new Date(msg.provider_timestamp) : null,
        observedAt: now,
        sourceJson: null,
        metadataJson: {},
        createdAt: now,
      });
      insertedRows.push({ id: messageId, ordinal: currentOrdinal });
    }

    const newCount = newMessages.length - duplicateCount;
    if (newCount > 0) {
      await tx.update(sessions).set({ lastMessageAt: now }).where(eq(sessions.id, sessionId));
    }

    await tx.insert(events).values({
      id: createId('evt'),
      sessionId,
      topicId: session.topicId,
      action: 'message.appended',
      actor,
      detailsJson: {
        message_count: newCount,
        first_ordinal: firstNewOrdinal,
        ...(duplicateCount > 0 ? { skipped_duplicates: duplicateCount } : {}),
      },
      createdAt: now,
    });

    let title = session.title;
    if (suggestedTitle) {
      title = await applySuggestedSessionTitle(tx, sessionId, session.topicId, session.title, suggestedTitle, actor);
    }

    return { inserted: insertedRows, finalTitle: title, duplicates: duplicateCount };
  });

  return {
    ok: true,
    messages: inserted,
    duplicates,
    session: { id: sessionId, title: finalTitle, last_message_at: now.toISOString() },
  };
}

export interface CompactionSuccess {
  ok: true;
  compaction: { id: string; session_id: string; created_at: string };
}

/**
 * Store a durable compaction record alongside the raw messages (never replacing
 * them).
 */
export async function recordCompaction(params: {
  sessionId: string;
  compact: NormalizedCompact;
  actor: string;
}): Promise<CompactionSuccess | { ok: false; code: StoreFailureCode }> {
  const { sessionId, compact, actor } = params;

  const [session] = await db
    .select({ archived: sessions.archived, topicId: sessions.topicId })
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) return { ok: false, code: 'NOT_FOUND' };
  if (session.archived) return { ok: false, code: 'SESSION_ARCHIVED' };

  const now = new Date();
  const compactionId = createId('cmp');

  await db.transaction(async (tx) => {
    await tx.insert(compactions).values({
      id: compactionId,
      sessionId,
      summary: compact.summary,
      timelineJson: (compact.timeline ?? null) as never,
      decisionsJson: (compact.decisions ?? null) as never,
      requirementsJson: (compact.requirements ?? null) as never,
      openQuestionsJson: (compact.open_questions ?? null) as never,
      artifactsJson: (compact.artifacts ?? null) as never,
      warningsJson: (compact.warnings ?? null) as never,
      provider: compact.provider || 'unknown',
      baseModel: compact.base_model || 'unknown',
      metadataJson: (compact.metadata ?? {}) as never,
      createdAt: now,
    });

    await tx.insert(events).values({
      id: createId('evt'),
      sessionId,
      topicId: session.topicId,
      action: 'compaction.recorded',
      actor,
      detailsJson: { compaction_id: compactionId, summary_chars: compact.summary.length },
      createdAt: now,
    });
  });

  return {
    ok: true,
    compaction: { id: compactionId, session_id: sessionId, created_at: now.toISOString() },
  };
}
