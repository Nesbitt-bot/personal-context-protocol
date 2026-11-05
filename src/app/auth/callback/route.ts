import { NextRequest, NextResponse } from 'next/server';
import { readOidcConfig } from '@/lib/oidc-config';
import { completeLogin } from '@/lib/oidc-login';
import { db } from '@/lib/db';
import { events } from '@/lib/schema';
import { createId } from '@/lib/auth';
import { logError } from '@/lib/logging';
import {
  OIDC_STATE_COOKIE,
  SESSION_COOKIE,
  clearOidcStateCookie,
  clearSessionCookies,
  createWebSession,
  destroyWebSession,
  setSessionCookies,
} from '@/lib/web-session';

export const dynamic = 'force-dynamic';

/**
 * Casdoor redirect target (PCP_OIDC_REDIRECT_URI, path /auth/callback).
 * Creates a brand-new browser session on success (any previous session cookie
 * is revoked first) and never creates a session on any failure.
 */
export async function GET(request: NextRequest) {
  const oidc = readOidcConfig();

  const deny = (code: string) => {
    const path = `/login?auth_error=${encodeURIComponent(code)}`;
    // Without OIDC configuration there is no trusted public origin, so use a
    // relative Location rather than the (possibly internal) request URL.
    const response = oidc.enabled
      ? NextResponse.redirect(new URL(path, oidc.config.appOrigin), 303)
      : new NextResponse(null, { status: 303, headers: { Location: path } });
    clearOidcStateCookie(response);
    clearSessionCookies(response);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };

  if (!oidc.enabled) return deny('OIDC_DISABLED');

  try {
    const params = request.nextUrl.searchParams;
    const result = await completeLogin(
      oidc.config,
      { code: params.get('code'), state: params.get('state'), error: params.get('error') },
      request.cookies.get(OIDC_STATE_COOKIE)?.value,
    );

    if (!result.ok) {
      console.warn(`Sign-in denied: OIDC login / callback - ${result.code}: ${result.reason}`);
      return deny(result.code);
    }

    // Session fixation defence: never reuse a session id from before login.
    await destroyWebSession(request.cookies.get(SESSION_COOKIE)?.value);
    const session = await createWebSession(result.userId);
    await db.insert(events).values({
      id: createId('evt'),
      action: 'auth.login',
      actor: 'human',
      detailsJson: { user_id: result.userId, is_admin: result.isAdmin, method: 'oidc' },
      createdAt: new Date(),
    });

    const response = NextResponse.redirect(new URL(result.returnTo, oidc.config.appOrigin), 303);
    clearOidcStateCookie(response);
    setSessionCookies(response, session.sessionValue, session.csrfValue);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    logError({
      consequence: 'Unable to complete sign-in',
      moduleProcess: 'OIDC login / callback',
      cause: 'login state lookup, user upsert or session creation failed',
      error,
    });
    return deny('LOGIN_FAILED');
  }
}
