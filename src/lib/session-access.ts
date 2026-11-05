import { and, eq, inArray, ne, or, SQL } from 'drizzle-orm';
import { db } from './db';
import { identities, sessions } from './schema';
import type { UiActor, UiAuthError } from './ui-auth';

/**
 * Session-level authorization for human (web UI) callers.
 *
 * - Admins (PCP admin group, or the break-glass admin) see every session.
 * - Group-class sessions are admin-only: every group member reads replies, so
 *   no single member may own them.
 * - Otherwise a user sees sessions they own, or whose `principal` is a
 *   platform identity linked to them.
 * - Unowned sessions without a linked principal are therefore admin-only.
 */

export type SessionClass = 'trusted' | 'unattributed' | 'group';

export interface SessionAccessInfo {
  ownerUserId: string | null;
  principal: string | null;
  sessionClass: SessionClass | string;
}

export function canAccessSession(
  actor: Pick<UiActor, 'isAdmin' | 'userId'>,
  session: SessionAccessInfo,
  linkedPrincipals: ReadonlySet<string>,
): boolean {
  if (actor.isAdmin) return true;
  if (session.sessionClass === 'group') return false;
  if (session.ownerUserId && session.ownerUserId === actor.userId) return true;
  if (session.principal && linkedPrincipals.has(session.principal)) return true;
  return false;
}

export async function linkedPrincipalsFor(userId: string): Promise<Set<string>> {
  const rows = await db.select({ principal: identities.principal }).from(identities).where(eq(identities.userId, userId));
  return new Set(rows.map((row) => row.principal));
}

/**
 * SQL filter for session list queries. Returns undefined for admins (no
 * filter). Mirrors canAccessSession.
 */
export function visibleSessionsFilter(actor: UiActor): SQL | undefined {
  if (actor.isAdmin) return undefined;
  const linked = db.select({ principal: identities.principal }).from(identities).where(eq(identities.userId, actor.userId));
  return and(
    ne(sessions.sessionClass, 'group'),
    or(eq(sessions.ownerUserId, actor.userId), inArray(sessions.principal, linked)),
  );
}

/**
 * Gate a route on one session. 404 when it does not exist, 403 when the actor
 * may not see it. `consequence` is e.g. "Unable to get session".
 */
export async function authorizeSession(actor: UiActor, sessionId: string, consequence: string): Promise<UiAuthError | null> {
  const [session] = await db
    .select({ ownerUserId: sessions.ownerUserId, principal: sessions.principal, sessionClass: sessions.sessionClass })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) {
    return { error: `${consequence}: web UI authorization / session lookup - session not found`, code: 'NOT_FOUND', status: 404 };
  }
  if (actor.isAdmin) return null;

  const linked = session.principal ? await linkedPrincipalsFor(actor.userId) : new Set<string>();
  if (canAccessSession(actor, session, linked)) return null;
  return {
    error: `${consequence}: web UI authorization / session ownership check - this session is not owned by or linked to your account`,
    code: 'FORBIDDEN',
    status: 403,
  };
}

/** Principal strings look like `platform:id` or `platform:kind:id`. */
export const PRINCIPAL_PATTERN = /^[a-z][a-z0-9_-]{0,63}(:[A-Za-z0-9._@+=-]{1,128}){1,3}$/;

export function isValidPrincipal(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 300 && PRINCIPAL_PATTERN.test(value);
}
