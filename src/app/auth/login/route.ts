import { NextRequest, NextResponse } from 'next/server';
import { readOidcConfig } from '@/lib/oidc-config';
import { OidcError } from '@/lib/oidc';
import { startLogin } from '@/lib/oidc-login';
import { ensureDatabaseSchema } from '@/lib/setup-schema';
import { setOidcStateCookie } from '@/lib/web-session';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Back to the login page with an error code. Without OIDC configuration there
 * is no trusted public origin (behind a proxy request.url may be the bind
 * address), so a relative Location is used.
 */
function loginPage(origin: string | null, code: string) {
  const path = `/login?auth_error=${encodeURIComponent(code)}`;
  if (origin) return NextResponse.redirect(new URL(path, origin), 303);
  return new NextResponse(null, { status: 303, headers: { Location: path, 'Cache-Control': 'no-store' } });
}

/** Start Casdoor sign-in: store state/nonce/PKCE, then redirect to the IdP. */
export async function GET(request: NextRequest) {
  const oidc = readOidcConfig();
  // Fail closed: without complete OIDC configuration nobody can sign in.
  if (!oidc.enabled) return loginPage(null, 'OIDC_DISABLED');

  try {
    await ensureDatabaseSchema();
    const next = request.nextUrl.searchParams.get('next');
    const { redirectUrl, browserValue } = await startLogin(oidc.config, next);
    const response = NextResponse.redirect(redirectUrl, 303);
    setOidcStateCookie(response, browserValue);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    logError({
      consequence: 'Unable to start sign-in',
      moduleProcess: 'OIDC login / authorization request',
      cause: error instanceof OidcError ? error.message : 'discovery or login state storage failed',
      error: error instanceof OidcError ? undefined : error,
    });
    return loginPage(oidc.config.appOrigin, error instanceof OidcError ? error.code : 'LOGIN_START_FAILED');
  }
}
