import { NextRequest, NextResponse } from 'next/server';
import { verifyUiToken } from './middleware';
import { breakGlassEnabled, BREAK_GLASS_ENV } from './oidc-config';
import { CSRF_HEADER, SESSION_COOKIE, csrfMatches, lookupWebSession } from './web-session';
import { logError } from './logging';

/**
 * Who is calling a human-facing (web UI) API route.
 *
 * - `user`: a Casdoor OIDC user with a browser session cookie. `isAdmin`
 *   comes from the admin group at login.
 * - `break_glass`: the legacy single admin token sent as a Bearer header. Only
 *   accepted when PCP_BREAK_GLASS_ADMIN_LOGIN=1; otherwise rejected.
 *
 * Agent credentials (per-session recording tokens, scoped manager tokens) are
 * never accepted here; they have their own routes and verifiers.
 */
export type UiActor =
  | { kind: 'user'; userId: string; displayName: string; isAdmin: boolean }
  | { kind: 'break_glass'; userId: 'admin'; displayName: 'Break-glass admin'; isAdmin: true };

export type UiAuthError = { error: string; code: string; status: number };
export type UiAuthResult = { success: true; actor: UiActor; userId: string } | UiAuthError;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function authenticateUi(request: NextRequest): Promise<UiAuthResult> {
  const authHeader = request.headers.get('authorization');

  if (authHeader) {
    if (!breakGlassEnabled()) {
      return {
        error: `Unable to access: web UI authentication / break-glass admin token - admin-token login is disabled; sign in with Casdoor instead (an operator can enable the break-glass path with ${BREAK_GLASS_ENV}=1)`,
        code: 'BREAK_GLASS_DISABLED',
        status: 401,
      };
    }
    const result = await verifyUiToken(request);
    if (!('success' in result)) return { error: result.error, code: result.code, status: result.status };
    // A Bearer header is never sent automatically by a browser, so the
    // break-glass path is not exposed to cross-site request forgery.
    const actor: UiActor = { kind: 'break_glass', userId: 'admin', displayName: 'Break-glass admin', isAdmin: true };
    return { success: true, actor, userId: actor.userId };
  }

  const sessionValue = request.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionValue) {
    return {
      error: 'Unable to access: web UI authentication / session cookie check - not signed in. Sign in with Casdoor at /login.',
      code: 'UNAUTHORIZED',
      status: 401,
    };
  }

  try {
    const lookup = await lookupWebSession(sessionValue);
    if (!lookup.found) {
      return {
        error: 'Unable to access: web UI authentication / session lookup - the sign-in session is unknown or expired. Sign in again at /login.',
        code: 'SESSION_EXPIRED',
        status: 401,
      };
    }

    if (!SAFE_METHODS.has(request.method.toUpperCase()) && !csrfMatches(request.headers.get(CSRF_HEADER), lookup.csrfHash)) {
      return {
        error: 'Unable to change data: web UI authentication / CSRF check - the X-PCP-CSRF header is missing or does not match this sign-in session. Reload the page and try again.',
        code: 'CSRF_REJECTED',
        status: 403,
      };
    }

    const actor: UiActor = {
      kind: 'user',
      userId: lookup.user.userId,
      displayName: lookup.user.displayName,
      isAdmin: lookup.user.isAdmin,
    };
    return { success: true, actor, userId: actor.userId };
  } catch (error) {
    logError({
      consequence: 'Unable to verify sign-in session',
      moduleProcess: 'web UI authentication / session lookup',
      cause: 'session or user query failed',
      error,
    });
    return {
      error: 'Unable to verify sign-in session: web UI authentication / session lookup - internal error occurred',
      code: 'INTERNAL_ERROR',
      status: 500,
    };
  }
}

/** Admin-only gate. `consequence` is e.g. "Unable to create topic". */
export function requireAdmin(actor: UiActor, consequence: string): UiAuthError | null {
  if (actor.isAdmin) return null;
  return {
    error: `${consequence}: web UI authorization / admin check - this action needs membership in the PCP admin group`,
    code: 'FORBIDDEN',
    status: 403,
  };
}

export function authErrorResponse(result: UiAuthError) {
  return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
}
