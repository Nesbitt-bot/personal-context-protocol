import { NextRequest, NextResponse } from 'next/server';
import { CSRF_HEADER, SESSION_COOKIE, clearSessionCookies, csrfMatches, destroyWebSession, lookupWebSession } from '@/lib/web-session';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/** Sign out: revoke the server-side session (CSRF-checked) and clear cookies. */
export async function POST(request: NextRequest) {
  const sessionValue = request.cookies.get(SESSION_COOKIE)?.value;
  try {
    if (sessionValue) {
      const lookup = await lookupWebSession(sessionValue);
      if (lookup.found && !csrfMatches(request.headers.get(CSRF_HEADER), lookup.csrfHash)) {
        return NextResponse.json(
          { error: 'Unable to sign out: web UI authentication / CSRF check - the X-PCP-CSRF header is missing or does not match this sign-in session', code: 'CSRF_REJECTED' },
          { status: 403 },
        );
      }
      await destroyWebSession(sessionValue);
    }
    const response = NextResponse.json({ success: true });
    clearSessionCookies(response);
    return response;
  } catch (error) {
    logError({ consequence: 'Unable to sign out', moduleProcess: 'web UI authentication / logout', cause: 'session revocation failed', error });
    return NextResponse.json({ error: 'Unable to sign out: web UI authentication / logout - session revocation failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
