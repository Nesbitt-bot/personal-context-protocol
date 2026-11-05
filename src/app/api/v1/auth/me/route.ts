import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse } from '@/lib/ui-auth';

export const dynamic = 'force-dynamic';

/** Who is signed in. 401 when anonymous. */
export async function GET(request: NextRequest) {
  const auth = await authenticateUi(request);
  if ('error' in auth) return authErrorResponse(auth);
  return NextResponse.json({
    user_id: auth.actor.userId,
    display_name: auth.actor.displayName,
    is_admin: auth.actor.isAdmin,
    method: auth.actor.kind === 'user' ? 'oidc' : 'break_glass',
  });
}
