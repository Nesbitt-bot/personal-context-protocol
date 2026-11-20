import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { accessCodes, events } from './schema';
import { createId, generateSalt, generateToken, hashToken, verifyToken } from './auth';

/**
 * Temporary bind/sync access codes (migration 019).
 *
 * A code embedded in `/l/<code>` is the whole credential: it grants append/read
 * access to one session for a sliding 1-hour idle window, hard-capped at 24
 * hours from creation. Each agent update (a page/instruction fetch or an
 * upload) refreshes the idle window. Only the code's hash is stored.
 */

export const ACCESS_CODE_IDLE_MS = 60 * 60 * 1000;
export const ACCESS_CODE_ABSOLUTE_MS = 24 * 60 * 60 * 1000;

export type AccessCodeStatus = 'active' | 'revoked' | 'expired' | 'idle_expired' | 'unknown';

export function accessCodeStatus(
  row: { revoked: boolean; expiresAt: Date; lastUsedAt: Date },
  now: Date,
): AccessCodeStatus {
  if (row.revoked) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (now.getTime() - row.lastUsedAt.getTime() > ACCESS_CODE_IDLE_MS) return 'idle_expired';
  return 'active';
}

export async function createAccessCode(sessionId: string, actor: string, now = new Date()) {
  // One active temporary link per session: revoke any earlier codes first so a
  // stale link can never be used to write after a newer one was handed out.
  await db
    .update(accessCodes)
    .set({ revoked: true })
    .where(and(eq(accessCodes.sessionId, sessionId), eq(accessCodes.revoked, false)));

  const code = generateToken();
  const salt = generateSalt();
  const codeHash = await hashToken(code, salt);
  const id = createId('lnk');

  const [row] = await db
    .insert(accessCodes)
    .values({
      id,
      codeHash,
      salt,
      codePrefix: code.substring(0, 16),
      sessionId,
      createdBy: actor,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + ACCESS_CODE_ABSOLUTE_MS),
    })
    .returning();

  await db.insert(events).values({
    id: createId('evt'),
    sessionId,
    action: 'access_code.created',
    actor,
    detailsJson: { access_code_id: id, expires_at: row.expiresAt.toISOString() },
    createdAt: now,
  });

  return { id: row.id, code, sessionId, expiresAt: row.expiresAt };
}

export type AccessCodeResolve =
  | { status: 'ok'; row: typeof accessCodes.$inferSelect }
  | { status: Exclude<AccessCodeStatus, 'ok' | 'active'> };

/** Look up a raw code and evaluate its status without mutating anything. */
export async function resolveAccessCode(code: string, now = new Date()): Promise<AccessCodeResolve> {
  const prefix = code.substring(0, 16);
  const candidates = await db.select().from(accessCodes).where(eq(accessCodes.codePrefix, prefix)).limit(10);
  for (const row of candidates) {
    if (await verifyToken(code, row.codeHash, row.salt)) {
      const status = accessCodeStatus(row, now);
      if (status !== 'active') return { status };
      return { status: 'ok', row };
    }
  }
  return { status: 'unknown' };
}

/** Refresh the idle window (called on any agent activity). */
export async function touchAccessCode(id: string, now = new Date()) {
  await db.update(accessCodes).set({ lastUsedAt: now }).where(eq(accessCodes.id, id));
}

export async function revokeAccessCode(id: string, actor: string, now = new Date()) {
  const [row] = await db.update(accessCodes).set({ revoked: true }).where(eq(accessCodes.id, id)).returning();
  if (row) {
    await db.insert(events).values({ id: createId('evt'), sessionId: row.sessionId, action: 'access_code.revoked', actor, detailsJson: { access_code_id: id }, createdAt: now });
  }
  return row ?? null;
}
