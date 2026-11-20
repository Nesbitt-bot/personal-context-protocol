import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import { compactions, events, messages, messageSyncKeys, sessions } from './schema';
import { createId } from './auth';
import { lastImportOrdinal } from './import-receipts';
import type { SessionDocument } from './session-document';

/** Use the same content projection as search/indexer.js, from the authoritative database. */
export async function exportSessionDocument(id: string): Promise<SessionDocument | null> {
  const rows = await db.execute(sql`
    select s.id as sid, s.title,
      concat_ws(' ', s.context_title, s.context_summary,
        (select string_agg(c.summary, ' ' order by c.created_at, c.id) from compactions c where c.session_id = s.id)) as summary,
      coalesce((select json_agg(json_build_object('ordinal', m.ordinal, 'role', m.role, 'content', m.content) order by m.ordinal)
        from messages m where m.session_id = s.id), '[]') as messages
    from sessions s where s.id = ${id}
  `);
  return (rows[0] as unknown as SessionDocument) || null;
}

export class DocumentImportError extends Error {
  constructor(public status: number, public code: string, cause: string) {
    super(`Unable to import JSON: session document / destination check - ${cause}`);
  }
}

/** Merge atomically into the selected session; the file's sid never selects a write target. */
export async function importSessionDocument(id: string, document: SessionDocument, actor: string) {
  return db.transaction(async tx => {
    const [session] = await tx.select({ id: sessions.id, topicId: sessions.topicId,
      archived: sessions.archived, mode: sessions.mode, contextTitle: sessions.contextTitle,
      contextSummary: sessions.contextSummary,
    }).from(sessions).where(eq(sessions.id, id)).for('update');
    if (!session) throw new DocumentImportError(404, 'NOT_FOUND', 'session not found');
    if (session.archived || session.mode === 'locked') {
      throw new DocumentImportError(409, 'SESSION_READ_ONLY', 'session is archived or locked');
    }
    const existing = await tx.select().from(messages).where(eq(messages.sessionId, id)).orderBy(messages.ordinal);
    const aliases = await tx.select().from(messageSyncKeys).where(eq(messageSyncKeys.sessionId, id));
    const known = new Set([...existing.map(row => row.externalMessageId), ...aliases.map(row => row.externalId)]);
    const knownRows = new Map([
      ...existing.filter(row => row.externalMessageId).map(row => [row.externalMessageId!, row.id] as const),
      ...aliases.map(row => [row.externalId, row.messageId] as const),
    ]);
    const incoming = [...document.messages].sort((a, b) => a.ordinal - b.ordinal).map(message => ({
      ...message,
      key: `document:${createHash('sha256').update(JSON.stringify([document.sid, message.ordinal, message.role, message.content])).digest('hex')}`,
    }));
    const claimed = new Set(incoming.map(message => knownRows.get(message.key)).filter(Boolean));
    const available = new Map<string, (typeof existing)[number][]>();
    for (const row of existing) {
      if (claimed.has(row.id)) continue;
      const key = JSON.stringify([row.role, row.content]);
      const matches = available.get(key) || [];
      matches.push(row); available.set(key, matches);
    }
    const inserts: (typeof messages.$inferInsert)[] = [];
    const links: (typeof messageSyncKeys.$inferInsert)[] = [];
    const now = new Date();
    let ordinal = await lastImportOrdinal(tx, id);
    for (const message of incoming) {
      if (known.has(message.key)) continue;
      // Consume matches one at a time: two identical turns in a file remain two turns.
      const match = available.get(JSON.stringify([message.role, message.content]))?.shift();
      if (match) links.push({ sessionId: id, externalId: message.key, messageId: match.id });
      else inserts.push({ id: createId('msg'), sessionId: id, topicId: session.topicId,
        ordinal: ++ordinal, role: message.role, content: message.content, contentType: 'markdown',
        observedAt: now, createdAt: now, externalMessageId: message.key });
    }
    for (let offset = 0; offset < inserts.length; offset += 100) await tx.insert(messages).values(inserts.slice(offset, offset + 100));
    for (let offset = 0; offset < links.length; offset += 100) await tx.insert(messageSyncKeys).values(links.slice(offset, offset + 100));
    const [compact] = await tx.select({ id: compactions.id }).from(compactions).where(eq(compactions.sessionId, id)).limit(1);
    const initialize = existing.length === 0 && !session.contextTitle && !session.contextSummary && !compact;
    if (initialize || inserts.length) {
      await tx.update(sessions).set({ updatedAt: now,
        ...(inserts.length ? { lastMessageAt: now } : {}),
        ...(initialize ? { title: document.title, contextSummary: document.summary } : {}),
      }).where(eq(sessions.id, id));
    }
    await tx.insert(events).values({ id: createId('evt'), sessionId: id, topicId: session.topicId,
      action: 'session.document_imported', actor, createdAt: now,
      detailsJson: { source_session_id: document.sid, imported: inserts.length, skipped: incoming.length - inserts.length, metadata_initialized: initialize },
    });
    return { imported: inserts.length, skipped: incoming.length - inserts.length, metadata_initialized: initialize };
  });
}
