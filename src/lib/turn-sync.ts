import { and, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { attachments, events, messages, sessions, syncedTurns } from './schema';
import { createId } from './auth';
import type { AppendInput } from './recording-store';
import type { ActiveGrant } from './turn-grants';

/**
 * Grant-scoped sync and recall for channel plugins.
 *
 * - appendTurn writes one turn (a list of messages) to the grant's home
 *   session, idempotently by `external_key`: replaying the same key records
 *   nothing and returns the original ordinals. Messages stay append-only.
 * - recall / search read only sessions in the grant's readable set.
 */

export type SyncResult =
  | { ok: true; duplicate: boolean; sessionId: string; firstOrdinal: number; messageCount: number }
  | { ok: false; status: number; code: string; error: string };

export async function appendTurn(
  grant: ActiveGrant,
  externalKey: string,
  turn: AppendInput[],
  actor: string,
  now = new Date(),
): Promise<SyncResult> {
  return db.transaction(async (tx) => {
    // Lock the session row so concurrent turns get distinct ordinals.
    const [session] = await tx
      .select({ id: sessions.id, archived: sessions.archived, topicId: sessions.topicId })
      .from(sessions)
      .where(eq(sessions.id, grant.homeSessionId))
      .limit(1)
      .for('update');
    if (!session) return { ok: false as const, status: 404, code: 'NOT_FOUND', error: 'Unable to sync turn: service sync / session lookup - the grant\'s session no longer exists' };
    if (session.archived) return { ok: false as const, status: 409, code: 'SESSION_ARCHIVED', error: 'Unable to sync turn: service sync / session lookup - the session is archived' };

    const [existing] = await tx
      .select()
      .from(syncedTurns)
      .where(and(eq(syncedTurns.sessionId, session.id), eq(syncedTurns.externalKey, externalKey)))
      .limit(1);
    if (existing) {
      return { ok: true as const, duplicate: true, sessionId: session.id, firstOrdinal: existing.firstOrdinal, messageCount: existing.messageCount };
    }

    const [maxOrdinal] = await tx
      .select({ max: sql<number>`max(${messages.ordinal})` })
      .from(messages)
      .where(eq(messages.sessionId, session.id));
    const firstOrdinal = (maxOrdinal?.max ? Number(maxOrdinal.max) : 0) + 1;

    let ordinal = firstOrdinal;
    for (const message of turn) {
      await tx.insert(messages).values({
        id: createId('msg'),
        sessionId: session.id,
        topicId: session.topicId,
        ordinal,
        role: message.role,
        content: message.content,
        contentType: 'markdown',
        provider: message.provider || 'unknown',
        BaseModel: message.base_model || 'unknown',
        providerTimestamp: message.provider_timestamp ? new Date(message.provider_timestamp) : null,
        observedAt: now,
        sourceJson: null,
        metadataJson: { external_key: externalKey },
        createdAt: now,
      });
      ordinal += 1;
    }

    await tx.insert(syncedTurns).values({ sessionId: session.id, externalKey, firstOrdinal, messageCount: turn.length, createdAt: now });
    await tx.update(sessions).set({ lastMessageAt: now }).where(eq(sessions.id, session.id));
    await tx.insert(events).values({
      id: createId('evt'),
      sessionId: session.id,
      topicId: session.topicId,
      action: 'turn.synced',
      actor,
      detailsJson: { grant_id: grant.id, external_key: externalKey, message_count: turn.length, first_ordinal: firstOrdinal },
      createdAt: now,
    });
    return { ok: true as const, duplicate: false, sessionId: session.id, firstOrdinal, messageCount: turn.length };
  });
}

export interface RecalledMessage {
  session_id: string;
  ordinal: number;
  role: string;
  content: string;
  created_at: Date;
  attachments?: Array<{ id: string; filename: string }>;
}

/** Most recent messages across the readable set (or one readable session). */
export async function recallMessages(sessionIds: string[], limit: number): Promise<{ sessions: Array<{ id: string; title: string }>; messages: RecalledMessage[] }> {
  if (sessionIds.length === 0) return { sessions: [], messages: [] };
  const sessionRows = await db
    .select({ id: sessions.id, title: sessions.title })
    .from(sessions)
    .where(inArray(sessions.id, sessionIds));
  const rows = await db
    .select({ session_id: messages.sessionId, ordinal: messages.ordinal, role: messages.role, content: messages.content, created_at: messages.createdAt })
    .from(messages)
    .where(inArray(messages.sessionId, sessionIds))
    .orderBy(desc(messages.createdAt), desc(messages.ordinal))
    .limit(limit);
  return { sessions: sessionRows, messages: await withAttachments(rows.reverse()) };
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Case-insensitive substring search over the readable set. */
export async function searchMessages(sessionIds: string[], query: string, limit: number): Promise<RecalledMessage[]> {
  if (sessionIds.length === 0) return [];
  const rows = await db
    .select({ session_id: messages.sessionId, ordinal: messages.ordinal, role: messages.role, content: messages.content, created_at: messages.createdAt })
    .from(messages)
    .where(and(inArray(messages.sessionId, sessionIds), ilike(messages.content, `%${escapeLike(query)}%`)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return withAttachments(rows);
}

async function withAttachments(rows: RecalledMessage[]): Promise<RecalledMessage[]> {
  if (!rows.length) return rows;
  const media = await db.select({ id: attachments.id, filename: attachments.filename, sessionId: messages.sessionId, ordinal: messages.ordinal })
    .from(attachments).innerJoin(messages, eq(messages.id, attachments.messageId))
    .where(inArray(attachments.sessionId, [...new Set(rows.map(row => row.session_id))]));
  return rows.map(row => ({ ...row, attachments: media.filter(m => m.sessionId === row.session_id && m.ordinal === row.ordinal).map(({ id, filename }) => ({ id, filename })) }));
}
