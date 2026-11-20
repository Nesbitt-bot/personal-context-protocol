import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { logError } from '@/lib/logging';
import { createTask, TaskError } from '@/lib/task-store';
import { listBoard } from '@/lib/task-views';
import { createTaskSchema } from '@/lib/task-validations';
import { TASK_SORT_KEYS, type SortDir, type TaskSortKey } from '@/lib/task-types';

export const dynamic = 'force-dynamic';

const SORTS = new Set<string>(TASK_SORT_KEYS);
const DIRS = new Set<string>(['asc', 'desc']);

/** The sprint board: board name, categories, projects and the sorted task list. */
export async function GET(request: NextRequest) {
  const consequence = 'Unable to list tasks';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);

    const q = request.nextUrl.searchParams;
    const sortRaw = q.get('sort') || 'updated';
    const dirRaw = q.get('dir') || undefined;
    const sort = SORTS.has(sortRaw) ? (sortRaw as TaskSortKey) : 'updated';
    const dir = dirRaw && DIRS.has(dirRaw) ? (dirRaw as SortDir) : undefined;

    return NextResponse.json(await listBoard(sort, dir));
  } catch (error) {
    logError({ consequence, moduleProcess: 'task administration / list board', cause: 'board query failed', error });
    return NextResponse.json({ error: `${consequence}: task administration / list board - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/** Create a task, optionally under a category or as a subtask. Admin only. */
export async function POST(request: NextRequest) {
  const consequence = 'Unable to create task';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);

    const parsed = createTaskSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: `${consequence}: task administration / request validation - invalid request body`, code: 'VALIDATION_ERROR', details: parsed.error.errors }, { status: 400 });
    }
    const body = parsed.data;
    const task = await createTask(
      {
        title: body.title,
        description: body.description,
        topicId: body.topic_id,
        parentId: body.parent_id,
        priority: body.priority,
        expectedTurns: body.expected_turns,
        dueAt: body.due_at,
        projectIds: body.project_ids,
        primaryProjectId: body.primary_project_id,
      },
      `human:${auth.actor.userId}`,
    );
    return NextResponse.json({ success: true, id: task.id, title: task.title, topic_id: task.topicId, parent_id: task.parentId }, { status: 201 });
  } catch (error) {
    if (error instanceof TaskError) {
      return NextResponse.json({ error: `${consequence}: ${error.message}`, code: 'INVALID_TASK_REFERENCE' }, { status: error.status });
    }
    logError({ consequence, moduleProcess: 'task administration / create task', cause: 'task insert failed', error });
    return NextResponse.json({ error: `${consequence}: task administration / create task - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
