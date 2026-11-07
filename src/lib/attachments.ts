import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { attachments, messages } from './schema';
import { createId } from './auth';
import { MediaError, persistMedia, StoredMedia } from './media';

export async function attachMedia(sessionId: string, ordinal: number, externalKey: string, media: StoredMedia[]) {
  if (!media.length) return;
  await db.transaction(async (tx) => {
    // Bound total stored references across sessions as well as each session.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('pcp-media-global-quota'))`);
    const [global] = await tx.select({ total: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)` }).from(attachments);
    let globalBytes = Number(global.total);
    // Serialize quota checks and imports across replicas for this session.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`);
    const [message] = await tx.select({ id: messages.id }).from(messages).where(and(eq(messages.sessionId, sessionId), eq(messages.ordinal, ordinal))).limit(1);
    if (!message) throw new MediaError(409, 'MESSAGE_REQUIRED', 'the associated message does not exist');
    const [usage] = await tx.select({ total: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)` }).from(attachments).where(eq(attachments.sessionId, sessionId));
    let size = Number(usage.total);
    for (const [i, item] of media.entries()) {
      const key = `${externalKey}:${i}`;
      const [existing] = await tx.select().from(attachments).where(and(eq(attachments.sessionId, sessionId), eq(attachments.externalKey, key))).limit(1);
      if (existing) {
        if (existing.uploadSha256 !== item.uploadHash) throw new MediaError(409, 'MEDIA_CONFLICT', 'replayed attachment key has different bytes');
        continue;
      }
      size += item.size; globalBytes += item.size;
      if (globalBytes > 50 * 1024 * 1024 * 1024) throw new MediaError(507, 'STORAGE_QUOTA', 'global media exceeds fifty GiB');
      if (size > 500 * 1024 * 1024) throw new MediaError(507, 'STORAGE_QUOTA', 'session media exceeds 500 MiB');
      await persistMedia(item);
      await tx.insert(attachments).values({ id: createId('att'), sessionId, messageId: message.id, externalKey: key,
        blobSha256: item.hash, uploadSha256: item.uploadHash, sizeBytes: item.size, mimeType: item.mime, filename: item.name });
    }
  });
}
