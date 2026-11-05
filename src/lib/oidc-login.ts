import { eq, lt } from 'drizzle-orm';
import { db } from './db';
import { oidcLoginStates, users } from './schema';
import { createId } from './auth';
import type { OidcConfig } from './oidc-config';
import {
  buildAuthorizationRequest,
  decideGroups,
  discover,
  exchangeCode,
  FetchLike,
  OidcError,
  randomUrlToken,
  safeEqual,
  verifyIdToken,
} from './oidc';
import { OIDC_STATE_TTL_MS, sanitizeReturnTo, sha256Hex } from './web-session';

/**
 * Server-side half of the Casdoor login. `startLogin` stores state, nonce and
 * the PKCE verifier under the hash of a random browser-bound value (kept in an
 * HttpOnly cookie). `completeLogin` consumes that row exactly once, exchanges
 * the code, verifies the ID token and enforces the required group before any
 * user row or session is created.
 */

export async function startLogin(config: OidcConfig, returnTo: string | null, fetchImpl: FetchLike = fetch, now = new Date()) {
  const discovery = await discover(config, fetchImpl);
  const request = buildAuthorizationRequest(config, discovery);
  const browserValue = randomUrlToken(32);
  await db.delete(oidcLoginStates).where(lt(oidcLoginStates.expiresAt, now));
  await db.insert(oidcLoginStates).values({
    idHash: sha256Hex(browserValue),
    state: request.state,
    nonce: request.nonce,
    codeVerifier: request.codeVerifier,
    returnTo: sanitizeReturnTo(returnTo),
    createdAt: now,
    expiresAt: new Date(now.getTime() + OIDC_STATE_TTL_MS),
  });
  return { redirectUrl: request.url, browserValue };
}

export type CompleteLoginResult =
  | { ok: true; userId: string; isAdmin: boolean; returnTo: string }
  | { ok: false; code: string; reason: string };

export async function completeLogin(
  config: OidcConfig,
  params: { code: string | null; state: string | null; error: string | null },
  browserValue: string | undefined,
  fetchImpl: FetchLike = fetch,
  now = new Date(),
): Promise<CompleteLoginResult> {
  if (!browserValue) return { ok: false, code: 'LOGIN_STATE_MISSING', reason: 'the login request cookie is missing (start sign-in again from /login)' };

  // Single use: delete and read in one statement so a replayed callback fails.
  const [pending] = await db
    .delete(oidcLoginStates)
    .where(eq(oidcLoginStates.idHash, sha256Hex(browserValue)))
    .returning();

  if (!pending) return { ok: false, code: 'LOGIN_STATE_MISSING', reason: 'the login request is unknown or was already used' };
  if (pending.expiresAt.getTime() <= now.getTime()) return { ok: false, code: 'LOGIN_STATE_EXPIRED', reason: 'the login request expired' };
  if (!params.state || !safeEqual(params.state, pending.state)) {
    return { ok: false, code: 'LOGIN_STATE_MISMATCH', reason: 'the state parameter does not match the login request' };
  }
  if (params.error) return { ok: false, code: 'OIDC_PROVIDER_DENIED', reason: 'the identity provider did not authorize the sign-in' };
  if (!params.code) return { ok: false, code: 'OIDC_CODE_MISSING', reason: 'the callback has no authorization code' };

  let identity;
  try {
    const discovery = await discover(config, fetchImpl);
    const idToken = await exchangeCode(config, discovery, params.code, pending.codeVerifier, fetchImpl);
    identity = await verifyIdToken(config, discovery, idToken, pending.nonce, fetchImpl);
  } catch (error) {
    if (error instanceof OidcError) return { ok: false, code: error.code, reason: error.message };
    throw error;
  }

  const decision = decideGroups(config, identity.groups);
  if (!decision.allowed) {
    return { ok: false, code: 'GROUP_REQUIRED', reason: 'your account is not in the group required to use PCP' };
  }

  const groupsSnapshot = identity.groups.slice(0, 200);
  const profile = {
    displayName: identity.displayName,
    email: identity.email,
    groupsJson: groupsSnapshot,
    isAdmin: decision.isAdmin,
    lastLoginAt: now,
  };
  const [row] = await db
    .insert(users)
    .values({ id: createId('usr'), oidcIssuer: config.issuer, oidcSub: identity.sub, createdAt: now, ...profile })
    .onConflictDoUpdate({ target: [users.oidcIssuer, users.oidcSub], set: profile })
    .returning({ id: users.id });
  const userId = row.id;

  return { ok: true, userId, isAdmin: decision.isAdmin, returnTo: pending.returnTo };
}
