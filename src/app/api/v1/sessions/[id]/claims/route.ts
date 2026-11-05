import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { sessions } from '@/lib/schema';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { createClaim } from '@/lib/claims';
import { resolveAppBaseUrl } from '@/lib/recording-url';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Admin: issue a single-use, 15-minute claim code for this session and a
 * platform principal (body `{ principal }`; defaults to the session's own).
 * The plaintext code is returned once and never stored.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, 'Unable to create claim code');
    if (denied) return authErrorResponse(denied);

    const body = await request.json().catch(() => ({}));
    const [session] = await db.select({ principal: sessions.principal }).from(sessions).where(eq(sessions.id, params.id)).limit(1);
    const principal = typeof body?.principal === 'string' ? body.principal.trim() : session?.principal ?? '';

    const result = await createClaim(params.id, principal);
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });

    const base = resolveAppBaseUrl(request.nextUrl.origin);
    return NextResponse.json({
      success: true,
      claim_id: result.claimId,
      code: result.code,
      claim_url: base ? `${base}/claim?code=${encodeURIComponent(result.code)}` : null,
      expires_at: result.expiresAt.toISOString(),
    });
  } catch (error) {
    logError({ consequence: 'Unable to create claim code', moduleProcess: 'identity claims / claim issue', cause: 'session lookup or claim insert failed', error });
    return NextResponse.json({ error: 'Unable to create claim code: identity claims / claim issue - session lookup or claim insert failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
