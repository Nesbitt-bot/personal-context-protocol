import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { conflictJson, listConflicts } from '@/lib/sync-store';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/** Sync conflicts flagged for review (admin). `?status=open|resolved|dismissed`. */
export async function GET(request: NextRequest) {
  const consequence = 'Unable to list sync conflicts';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const status = request.nextUrl.searchParams.get('status') || 'open';
    if (!['open', 'resolved', 'dismissed'].includes(status)) {
      return NextResponse.json({ error: `${consequence}: sync conflicts / query validation - status must be open, resolved or dismissed`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const rows = await listConflicts({ status });
    return NextResponse.json({ conflicts: rows.map(conflictJson) });
  } catch (error) {
    logError({ consequence, moduleProcess: 'sync conflicts / list', cause: 'conflict query failed', error });
    return NextResponse.json({ error: `${consequence}: sync conflicts / list - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
