import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { logError } from '@/lib/logging';
import { linkTaskSession, TaskError } from '@/lib/task-store';
import { linkTaskSessionSchema } from '@/lib/task-validations';

export const dynamic = 'force-dynamic';

/** Associate a session with this task (one task per session). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to link session';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const parsed = linkTaskSessionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: `${consequence}: task administration / request validation - invalid request body`, code: 'VALIDATION_ERROR', details: parsed.error.errors }, { status: 400 });
    }
    const session = await linkTaskSession(params.id, parsed.data.session_id, `human:${auth.actor.userId}`);
    if (!session) return NextResponse.json({ error: `${consequence}: task administration / session lookup - session not found`, code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ success: true, session_id: session.id, task_id: session.taskId });
  } catch (error) {
    if (error instanceof TaskError) {
      return NextResponse.json({ error: `${consequence}: ${error.message}`, code: 'INVALID_TASK_REFERENCE' }, { status: error.status });
    }
    logError({ consequence, moduleProcess: 'task administration / link session', cause: 'session link write failed', error });
    return NextResponse.json({ error: `${consequence}: task administration / link session - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
