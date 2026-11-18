import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse } from '@/lib/ui-auth';
import { authorizeSession } from '@/lib/session-access';
import { moveSessionWithTask } from '@/lib/task-store';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Move a session to another category, keeping its task consistent: the task's
 * category follows and every session bound to that task moves with it.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to move session';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = await authorizeSession(auth.actor, params.id, consequence);
    if (denied) return authErrorResponse(denied);

    const body = await request.json().catch(() => ({}));
    const topicId = body.topic_id === undefined || body.topic_id === null || body.topic_id === '' ? null : String(body.topic_id);

    const result = await moveSessionWithTask(params.id, topicId, `human:${auth.actor.userId}`);
    if (!result) return NextResponse.json({ error: `${consequence}: session administration / session lookup - session not found`, code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ success: true, moved_session_ids: result.movedSessionIds, moved_task_id: result.movedTaskId });
  } catch (error) {
    logError({ consequence, moduleProcess: 'session administration / move session with task', cause: 'session/task move failed', error });
    return NextResponse.json({ error: `${consequence}: session administration / move session with task - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
