import { eq } from 'drizzle-orm';
import { db } from './db';
import { sessions, sessionTokens, topics, events } from './schema';
import { createId, generateToken, generateSalt, hashToken } from './auth';
import { uniqueSessionTitle, uniqueTokenName } from './session-store';
import { resolveExpiresAt, type ExpirationChoice } from './token-expiration';

/**
 * Reusable write helpers for the scoped-token manager layer. They mirror the
 * admin routes' session/token creation but are actor-tagged `manager` so the
 * audit trail distinguishes human administration from a scoped worker.
 */

export async function createSessionRecord(opts: {
  topicId: string | null;
  title?: string;
  mode?: 'wild' | 'exact';
}): Promise<{ sessionId: string; title: string }> {
  if (opts.topicId) {
    const [topic] = await db
      .select({ id: topics.id, archived: topics.archived })
      .from(topics)
      .where(eq(topics.id, opts.topicId));
    if (!topic || topic.archived) {
      throw new Error('topic not found or archived');
    }
  }

  const title = await uniqueSessionTitle(opts.topicId, opts.title);
  const sessionId = createId('ses');
  const now = new Date();

  await db.insert(sessions).values({
    id: sessionId,
    topicId: opts.topicId,
    title,
    mode: opts.mode ?? 'wild',
    archived: false,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: null,
  });

  await db.insert(events).values({
    id: createId('evt'),
    sessionId,
    topicId: opts.topicId,
    action: 'session.created',
    actor: 'manager',
    detailsJson: { title, session_id: sessionId, topic_id: opts.topicId },
    createdAt: now,
  });

  return { sessionId, title };
}

export async function mintSessionTokenRecord(opts: {
  sessionId: string;
  name?: string;
  canRename?: boolean;
  expiresIn?: ExpirationChoice;
}): Promise<{ tokenId: string; token: string; name: string; expiresAt: Date | null } | null> {
  const [session] = await db
    .select({ title: sessions.title })
    .from(sessions)
    .where(eq(sessions.id, opts.sessionId));
  if (!session) return null;

  const name = await uniqueTokenName(opts.sessionId, opts.name, `${session.title} access token`);
  const token = generateToken();
  const salt = generateSalt();
  const tokenHash = await hashToken(token, salt);
  const tokenId = createId('tok');
  const now = new Date();
  const expiresAt = resolveExpiresAt(opts.expiresIn ?? 'never', now);

  await db.insert(sessionTokens).values({
    id: tokenId,
    sessionId: opts.sessionId,
    tokenHash,
    salt,
    name,
    canRenameSession: opts.canRename ?? false,
    tokenPrefix: token.substring(0, 16),
    expiresAt,
    createdAt: now,
  });

  await db.insert(events).values({
    id: createId('evt'),
    sessionId: opts.sessionId,
    action: 'token.created',
    actor: 'manager',
    detailsJson: { token_id: tokenId, token_name: name },
    createdAt: now,
  });

  return { tokenId, token, name, expiresAt };
}
