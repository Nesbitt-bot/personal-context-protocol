import { eq } from 'drizzle-orm';
import { db } from './db';
import { sessions, sessionTokens, topics, events } from './schema';
import { createId, generateToken, generateSalt, hashToken } from './auth';
import { uniqueSessionTitle, uniqueTokenName } from './session-store';
import { resolveExpiresAt, type ExpirationChoice } from './token-expiration';
import { ensureTaskForSession } from './task-store';

/**
 * Reusable write helpers for the scoped-token manager layer. They mirror the
 * admin routes' session/token creation but are actor-tagged `manager` so the
 * audit trail distinguishes human administration from a scoped worker.
 */

export async function createSessionRecord(opts: {
  topicId: string | null;
  title?: string;
  mode?: 'wild' | 'exact';
  externalKey?: string;
  agentName?: string | null;
  deviceId?: string | null;
  taskId?: string | null;
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
    externalKey: opts.externalKey ?? null,
    title,
    mode: opts.mode ?? 'wild',
    archived: false,
    agentName: opts.agentName ?? null,
    deviceId: opts.deviceId ?? null,
    taskId: opts.taskId ?? null,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: null,
  });

  // Invariant: every session has exactly one task. When the plugin did not
  // name one, create a task titled after the session and link it.
  if (!opts.taskId) {
    await ensureTaskForSession(sessionId, title, opts.topicId, opts.externalKey ?? null, 'manager', now);
  }

  await db.insert(events).values({
    id: createId('evt'),
    sessionId,
    topicId: opts.topicId,
    action: 'session.created',
    actor: 'manager',
    detailsJson: { title, session_id: sessionId, topic_id: opts.topicId, agent_name: opts.agentName ?? null, device_id: opts.deviceId ?? null, task_id: opts.taskId ?? null },
    createdAt: now,
  });

  return { sessionId, title };
}

/** Last-writer-wins identity stamp: which agent on which machine hosted a session. */
export async function stampSessionIdentity(sessionId: string, fields: { agentName?: string | null; deviceId?: string | null }, now = new Date()) {
  const set: Partial<typeof sessions.$inferInsert> = {};
  if (fields.agentName !== undefined) set.agentName = fields.agentName;
  if (fields.deviceId !== undefined) set.deviceId = fields.deviceId;
  if (!Object.keys(set).length) return;
  set.updatedAt = now;
  await db.update(sessions).set(set).where(eq(sessions.id, sessionId));
}

/** Find an existing manager-created session by its stable source identity. */
export async function findSessionByExternalKey(externalKey: string) {
  const [row] = await db
    .select({ id: sessions.id, topicId: sessions.topicId, title: sessions.title, mode: sessions.mode })
    .from(sessions)
    .where(eq(sessions.externalKey, externalKey));
  return row ?? null;
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
