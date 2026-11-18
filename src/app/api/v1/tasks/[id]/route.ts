import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { logError } from '@/lib/logging';
import { deleteTask, TaskError, updateTask } from '@/lib/task-store';
import { taskDetail } from '@/lib/task-views';
import { updateTaskSchema } from '@/lib/task-validations';
import { resolveAppBaseUrl } from '@/lib/recording-url';

export const dynamic = 'force-dynamic';

/** One task with its sessions and bound resources. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to load task';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const detail = await taskDetail(params.id, resolveAppBaseUrl(request.nextUrl.origin));
    if (!detail) return NextResponse.json({ error: `${consequence}: task administration / task lookup - task not found`, code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    logError({ consequence, moduleProcess: 'task administration / load task', cause: 'task query failed', error });
    return NextResponse.json({ error: `${consequence}: task administration / load task - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/** Edit task fields (title, category, parent, completed, priority, turns, ddl, position). */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to update task';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const parsed = updateTaskSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: `${consequence}: task administration / request validation - invalid request body`, code: 'VALIDATION_ERROR', details: parsed.error.errors }, { status: 400 });
    }
    const body = parsed.data;
    const task = await updateTask(params.id, {
      title: body.title,
      description: body.description,
      topicId: body.topic_id,
      parentId: body.parent_id,
      completed: body.completed,
      priority: body.priority,
      expectedTurns: body.expected_turns,
      dueAt: body.due_at,
      position: body.position,
    }, `human:${auth.actor.userId}`);
    if (!task) return NextResponse.json({ error: `${consequence}: task administration / task lookup - task not found`, code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ success: true, id: task.id });
  } catch (error) {
    if (error instanceof TaskError) {
      return NextResponse.json({ error: `${consequence}: ${error.message}`, code: 'INVALID_TASK_REFERENCE' }, { status: error.status });
    }
    logError({ consequence, moduleProcess: 'task administration / update task', cause: 'task update failed', error });
    return NextResponse.json({ error: `${consequence}: task administration / update task - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/** Delete a task; only allowed when it has no subtasks. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to delete task';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const task = await deleteTask(params.id, `human:${auth.actor.userId}`);
    if (!task) return NextResponse.json({ error: `${consequence}: task administration / task lookup - task not found`, code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ success: true, id: task.id });
  } catch (error) {
    if (error instanceof TaskError) {
      return NextResponse.json({ error: `${consequence}: ${error.message}`, code: 'TASK_NOT_EMPTY' }, { status: error.status });
    }
    logError({ consequence, moduleProcess: 'task administration / delete task', cause: 'task delete failed', error });
    return NextResponse.json({ error: `${consequence}: task administration / delete task - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
