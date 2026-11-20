import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { logError } from '@/lib/logging';
import { removeTaskResource } from '@/lib/task-store';

export const dynamic = 'force-dynamic';

/** Remove a bound resource. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string; resourceId: string } }) {
  const consequence = 'Unable to remove resource';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const resource = await removeTaskResource(params.id, params.resourceId, `human:${auth.actor.userId}`);
    if (!resource) return NextResponse.json({ error: `${consequence}: task administration / resource lookup - resource not found`, code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ success: true, id: resource.id });
  } catch (error) {
    logError({ consequence, moduleProcess: 'task administration / remove resource', cause: 'resource delete failed', error });
    return NextResponse.json({ error: `${consequence}: task administration / remove resource - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
