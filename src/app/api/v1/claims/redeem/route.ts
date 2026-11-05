import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse } from '@/lib/ui-auth';
import { redeemClaim } from '@/lib/claims';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Redeem a claim code for the signed-in Casdoor user (CSRF-checked). Links the
 * code's platform principal to this user and makes them the session owner.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    if (auth.actor.kind !== 'user') {
      return NextResponse.json(
        { error: 'Unable to redeem claim code: identity claims / account check - claims link an identity to a Casdoor account; sign in with Casdoor, not the break-glass admin token', code: 'OIDC_USER_REQUIRED' },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const result = await redeemClaim(auth.actor.userId, body?.code);
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ success: true, session_id: result.sessionId, principal: result.principal });
  } catch (error) {
    logError({ consequence: 'Unable to redeem claim code', moduleProcess: 'identity claims / claim redemption', cause: 'claim lookup or identity link transaction failed', error });
    return NextResponse.json({ error: 'Unable to redeem claim code: identity claims / claim redemption - claim lookup or identity link transaction failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
