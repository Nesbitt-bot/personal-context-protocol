import crypto from 'crypto';
import { and, count, eq, gt } from 'drizzle-orm';
import { db } from './db';
import { claimAttempts, claims, events, identities, sessions } from './schema';
import { createId } from './auth';
import { safeEqual } from './oidc';
import { isValidPrincipal } from './session-access';

/**
 * Single-use claim codes that link a platform principal (e.g. a Telegram user)
 * to a signed-in Casdoor user and hand them ownership of the session the code
 * was issued for. Codes:
 *
 * - carry 100 random bits (20 Crockford base32 characters);
 * - are stored only as a SHA-256 hash and looked up by that hash;
 * - expire 15 minutes after issue and can be redeemed once;
 * - are rate limited per user on redemption;
 * - grant nothing except this link, and only through the signed-in web UI.
 */

export const CLAIM_TTL_MS = 15 * 60 * 1000;
export const CLAIM_RATE_WINDOW_MS = 15 * 60 * 1000;
export const CLAIM_MAX_FAILURES_PER_WINDOW = 10;

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const CODE_LENGTH = 20;

export function generateClaimCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let raw = '';
  // 256 is a multiple of 32, so `byte % 32` is unbiased.
  for (const byte of bytes) raw += ALPHABET[byte % 32];
  return raw.match(/.{5}/g)!.join('-');
}

/** Canonical form (uppercase, no separators, Crockford aliases) or null. */
export function normalizeClaimCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 64) return null;
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const char of cleaned) if (!ALPHABET.includes(char)) return null;
  return cleaned;
}

export function hashClaimCode(normalized: string): string {
  return crypto.createHash('sha256').update(`pcp-claim:${normalized}`).digest('hex');
}

export type CreateClaimResult =
  | { ok: true; code: string; claimId: string; expiresAt: Date }
  | { ok: false; status: number; code: string; error: string };

/**
 * Issue a claim for a session and principal. The session must not be a group
 * session, and if it already has a principal it must be the same one.
 */
export async function createClaim(sessionId: string, principal: string, now = new Date()): Promise<CreateClaimResult> {
  const fail = (status: number, code: string, cause: string): CreateClaimResult => ({
    ok: false, status, code, error: `Unable to create claim code: identity claims / claim issue - ${cause}`,
  });
  if (!isValidPrincipal(principal)) return fail(400, 'INVALID_PRINCIPAL', 'principal must look like platform:id (e.g. telegram:123)');

  const [session] = await db
    .select({ id: sessions.id, principal: sessions.principal, sessionClass: sessions.sessionClass })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!session) return fail(404, 'NOT_FOUND', 'session not found');
  if (session.sessionClass === 'group') return fail(409, 'GROUP_SESSION', 'group sessions cannot be claimed');
  if (session.principal && session.principal !== principal) {
    return fail(409, 'PRINCIPAL_MISMATCH', 'the session already belongs to a different principal');
  }

  if (!session.principal) {
    await db.update(sessions).set({ principal, sessionClass: 'trusted', updatedAt: now }).where(eq(sessions.id, sessionId));
  }

  const code = generateClaimCode();
  const claimId = createId('clm');
  const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS);
  await db.insert(claims).values({
    id: claimId,
    codeHash: hashClaimCode(normalizeClaimCode(code)!),
    sessionId,
    principal,
    createdAt: now,
    expiresAt,
  });
  return { ok: true, code, claimId, expiresAt };
}

export type RedeemClaimResult =
  | { ok: true; sessionId: string; principal: string }
  | { ok: false; status: number; code: string; error: string };

async function recordAttempt(userId: string, succeeded: boolean, now: Date) {
  await db.insert(claimAttempts).values({ id: createId('cla'), userId, succeeded, attemptedAt: now });
}

export async function recentClaimFailures(userId: string, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - CLAIM_RATE_WINDOW_MS);
  const [row] = await db
    .select({ n: count() })
    .from(claimAttempts)
    .where(and(eq(claimAttempts.userId, userId), eq(claimAttempts.succeeded, false), gt(claimAttempts.attemptedAt, since)));
  return Number(row?.n ?? 0);
}

/**
 * Redeem a claim code for a signed-in user. In one transaction (row locked):
 * the claim must exist, be unredeemed and unexpired; the principal must not be
 * linked to someone else; then the principal is linked, the session's owner is
 * set and the claim is marked redeemed.
 */
export async function redeemClaim(userId: string, rawCode: unknown, now = new Date()): Promise<RedeemClaimResult> {
  const fail = (status: number, code: string, cause: string): RedeemClaimResult => ({
    ok: false, status, code, error: `Unable to redeem claim code: identity claims / claim redemption - ${cause}`,
  });

  if ((await recentClaimFailures(userId, now)) >= CLAIM_MAX_FAILURES_PER_WINDOW) {
    return fail(429, 'RATE_LIMITED', 'too many failed attempts; wait 15 minutes and try again');
  }

  const normalized = normalizeClaimCode(rawCode);
  if (!normalized) {
    await recordAttempt(userId, false, now);
    return fail(400, 'CLAIM_INVALID', 'the code is not valid');
  }
  const codeHash = hashClaimCode(normalized);

  const outcome = await db.transaction(async (tx) => {
    const [claim] = await tx.select().from(claims).where(eq(claims.codeHash, codeHash)).limit(1).for('update');
    // Defence in depth: the indexed equality lookup is on a hash of a
    // high-entropy secret; compare once more in constant time.
    if (!claim || !safeEqual(claim.codeHash, codeHash)) return fail(400, 'CLAIM_INVALID', 'the code is not valid');
    if (claim.redeemedAt) return fail(409, 'CLAIM_ALREADY_REDEEMED', 'this code has already been used');
    if (claim.expiresAt.getTime() <= now.getTime()) return fail(410, 'CLAIM_EXPIRED', 'this code has expired; ask for a new one');

    const [session] = await tx
      .select({ id: sessions.id, ownerUserId: sessions.ownerUserId, principal: sessions.principal, sessionClass: sessions.sessionClass })
      .from(sessions)
      .where(eq(sessions.id, claim.sessionId))
      .limit(1)
      .for('update');
    if (!session) return fail(404, 'NOT_FOUND', 'the session for this code no longer exists');
    if (session.sessionClass === 'group') return fail(409, 'GROUP_SESSION', 'group sessions cannot be claimed');
    if (session.principal && session.principal !== claim.principal) {
      return fail(409, 'PRINCIPAL_MISMATCH', 'the session now belongs to a different principal');
    }
    if (session.ownerUserId && session.ownerUserId !== userId) {
      return fail(409, 'SESSION_OWNED', 'the session is already owned by another account');
    }

    const [existingLink] = await tx.select().from(identities).where(eq(identities.principal, claim.principal)).limit(1).for('update');
    if (existingLink && existingLink.userId !== userId) {
      return fail(409, 'PRINCIPAL_LINKED_ELSEWHERE', 'this platform identity is already linked to another account; ask an admin to unlink it');
    }
    if (!existingLink) {
      await tx.insert(identities).values({ principal: claim.principal, userId, linkMethod: 'claim', linkedAt: now });
    }

    await tx.update(claims).set({ redeemedBy: userId, redeemedAt: now }).where(eq(claims.id, claim.id));
    await tx
      .update(sessions)
      .set({ ownerUserId: userId, principal: claim.principal, sessionClass: 'trusted', updatedAt: now })
      .where(eq(sessions.id, session.id));
    await tx.insert(events).values({
      id: createId('evt'),
      sessionId: session.id,
      action: 'identity.claimed',
      actor: 'human',
      detailsJson: { user_id: userId, principal: claim.principal, claim_id: claim.id },
      createdAt: now,
    });
    return { ok: true as const, sessionId: session.id, principal: claim.principal };
  });

  await recordAttempt(userId, outcome.ok, now);
  return outcome;
}

/**
 * Owner for a new session with this principal: the linked user, if any. Used
 * by session-creating paths so later sessions are owned automatically.
 */
export async function ownerForPrincipal(principal: string | null | undefined): Promise<string | null> {
  if (!principal) return null;
  const [link] = await db.select({ userId: identities.userId }).from(identities).where(eq(identities.principal, principal)).limit(1);
  return link?.userId ?? null;
}
