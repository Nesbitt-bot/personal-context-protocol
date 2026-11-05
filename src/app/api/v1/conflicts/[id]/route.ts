import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { validationError } from '@/lib/project-access';
import { conflictStatusSchema } from '@/lib/project-validations';
import { conflictJson, setConflictStatus } from '@/lib/sync-store';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/** Mark an open conflict reviewed: `resolved` (the kept value is right) or `dismissed`. Admin only. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to update sync conflict';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const parsed = conflictStatusSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(consequence, 'sync conflicts / request validation', parsed.error.errors);
    const row = await setConflictStatus(params.id, parsed.data.status, `human:${auth.actor.userId}`);
    if (!row) return NextResponse.json({ error: `${consequence}: sync conflicts / status update - conflict not found or no longer open`, code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ conflict: conflictJson(row) });
  } catch (error) {
    logError({ consequence, moduleProcess: 'sync conflicts / status update', cause: 'conflict update failed', error });
    return NextResponse.json({ error: `${consequence}: sync conflicts / status update - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
