import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { logError } from '@/lib/logging';
import { unlinkTaskSession } from '@/lib/task-store';

export const dynamic = 'force-dynamic';

/** Detach a session from this task. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string; sessionId: string } }) {
  const consequence = 'Unable to unlink session';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const session = await unlinkTaskSession(params.id, params.sessionId, `human:${auth.actor.userId}`);
    if (!session) return NextResponse.json({ error: `${consequence}: task administration / session lookup - session not linked to this task`, code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ success: true, session_id: session.id, task_id: session.taskId });
  } catch (error) {
    logError({ consequence, moduleProcess: 'task administration / unlink session', cause: 'session unlink write failed', error });
    return NextResponse.json({ error: `${consequence}: task administration / unlink session - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
