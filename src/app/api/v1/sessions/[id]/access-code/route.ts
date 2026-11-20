import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse } from '@/lib/ui-auth';
import { authorizeSession } from '@/lib/session-access';
import { createAccessCode } from '@/lib/access-code';
import { resolveAppBaseUrl } from '@/lib/recording-url';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Generate a temporary bind/sync link for a session. The raw code is returned
 * only here; the URL (`/l/<code>`) is what a human hands to their agent.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to create access link';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = await authorizeSession(auth.actor, params.id, consequence);
    if (denied) return authErrorResponse(denied);

    const result = await createAccessCode(params.id, `human:${auth.actor.userId}`);
    const baseUrl = resolveAppBaseUrl(request.nextUrl.origin);

    return NextResponse.json({
      success: true,
      id: result.id,
      code: result.code,
      url: `${baseUrl}/l/${result.code}`,
      expires_at: result.expiresAt.toISOString(),
      idle_timeout_seconds: 3600,
    }, { status: 201 });
  } catch (error) {
    logError({ consequence, moduleProcess: 'session administration / create access link', cause: 'access code insert failed', error });
    return NextResponse.json({ error: `${consequence}: session administration / create access link - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
