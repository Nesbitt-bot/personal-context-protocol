import crypto from 'crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { NextResponse } from 'next/server';
import { db } from './db';
import { users, webSessions } from './schema';
import { randomUrlToken, safeEqual } from './oidc';

/**
 * Browser login sessions for OIDC users. The session cookie holds a random
 * 256-bit value; the database stores only its SHA-256. Each session also has a
 * CSRF token (synchronizer pattern): the browser reads it from a non-HttpOnly
 * cookie and echoes it in the `X-PCP-CSRF` header on state-changing requests,
 * and the server compares it with the hash stored on the session row.
 */

// `__Host-` cookies must be Secure, Path=/ and host-only (no Domain), so they
// cannot be set or shadowed by a sibling subdomain.
export const SESSION_COOKIE = '__Host-pcp_session';
export const CSRF_COOKIE = '__Host-pcp_csrf';
export const OIDC_STATE_COOKIE = '__Host-pcp_oidc';
export const CSRF_HEADER = 'x-pcp-csrf';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const OIDC_STATE_TTL_MS = 10 * 60 * 1000;

export function sha256Hex(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export interface WebSessionUser {
  userId: string;
  sub: string;
  displayName: string;
  email: string | null;
  isAdmin: boolean;
  groups: string[];
}

/** Create a fresh session row; returns the raw cookie values (never stored). */
export async function createWebSession(userId: string, now = new Date()) {
  const sessionValue = randomUrlToken(32);
  const csrfValue = randomUrlToken(32);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(webSessions).values({
    idHash: sha256Hex(sessionValue),
    userId,
    csrfHash: sha256Hex(csrfValue),
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
  });
  // Opportunistic cleanup keeps the table small without a scheduler.
  await db.delete(webSessions).where(lt(webSessions.expiresAt, now));
  return { sessionValue, csrfValue, expiresAt };
}

export async function destroyWebSession(sessionValue: string | undefined) {
  if (!sessionValue) return;
  await db.delete(webSessions).where(eq(webSessions.idHash, sha256Hex(sessionValue)));
}

export type WebSessionLookup =
  | { found: true; user: WebSessionUser; csrfHash: string }
  | { found: false };

export async function lookupWebSession(sessionValue: string, now = new Date()): Promise<WebSessionLookup> {
  const [row] = await db
    .select({
      csrfHash: webSessions.csrfHash,
      userId: users.id,
      sub: users.oidcSub,
      displayName: users.displayName,
      email: users.email,
      isAdmin: users.isAdmin,
      groups: users.groupsJson,
    })
    .from(webSessions)
    .innerJoin(users, eq(users.id, webSessions.userId))
    .where(and(eq(webSessions.idHash, sha256Hex(sessionValue)), gt(webSessions.expiresAt, now)))
    .limit(1);

  if (!row) return { found: false };
  return {
    found: true,
    csrfHash: row.csrfHash,
    user: {
      userId: row.userId,
      sub: row.sub,
      displayName: row.displayName,
      email: row.email,
      isAdmin: row.isAdmin,
      groups: Array.isArray(row.groups) ? (row.groups as string[]) : [],
    },
  };
}

export function csrfMatches(headerValue: string | null, csrfHash: string) {
  if (!headerValue) return false;
  return safeEqual(sha256Hex(headerValue), csrfHash);
}

const baseCookie = { secure: true, sameSite: 'lax' as const, path: '/' };

export function setSessionCookies(response: NextResponse, sessionValue: string, csrfValue: string) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  response.cookies.set(SESSION_COOKIE, sessionValue, { ...baseCookie, httpOnly: true, maxAge });
  // Readable by same-origin scripts so they can echo it; useless cross-site.
  response.cookies.set(CSRF_COOKIE, csrfValue, { ...baseCookie, httpOnly: false, maxAge });
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, '', { ...baseCookie, httpOnly: true, maxAge: 0 });
  response.cookies.set(CSRF_COOKIE, '', { ...baseCookie, httpOnly: false, maxAge: 0 });
}

export function setOidcStateCookie(response: NextResponse, value: string) {
  response.cookies.set(OIDC_STATE_COOKIE, value, { ...baseCookie, httpOnly: true, maxAge: Math.floor(OIDC_STATE_TTL_MS / 1000) });
}

export function clearOidcStateCookie(response: NextResponse) {
  response.cookies.set(OIDC_STATE_COOKIE, '', { ...baseCookie, httpOnly: true, maxAge: 0 });
}

export { sanitizeReturnTo } from './return-to';
