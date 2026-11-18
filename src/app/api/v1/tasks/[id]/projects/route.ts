import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { logError } from '@/lib/logging';
import { setTaskProjects, TaskError } from '@/lib/task-store';
import { setTaskProjectsSchema } from '@/lib/task-validations';

export const dynamic = 'force-dynamic';

/** Replace a task's repo-tag projects and its primary project. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to set task projects';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const parsed = setTaskProjectsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: `${consequence}: task administration / request validation - invalid request body`, code: 'VALIDATION_ERROR', details: parsed.error.errors }, { status: 400 });
    }
    const projectIds = await setTaskProjects(params.id, parsed.data.project_ids, parsed.data.primary_project_id ?? null, `human:${auth.actor.userId}`);
    return NextResponse.json({ success: true, project_ids: projectIds });
  } catch (error) {
    if (error instanceof TaskError) {
      return NextResponse.json({ error: `${consequence}: ${error.message}`, code: 'INVALID_TASK_REFERENCE' }, { status: error.status });
    }
    logError({ consequence, moduleProcess: 'task administration / set task projects', cause: 'project link write failed', error });
    return NextResponse.json({ error: `${consequence}: task administration / set task projects - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
