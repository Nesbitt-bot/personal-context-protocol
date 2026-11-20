import { NextRequest, NextResponse } from 'next/server';
import { requireProjectToken, validationError } from '@/lib/project-access';
import { managerTaskSchema } from '@/lib/project-validations';
import { ensureTaskByExternalKey, linkTaskSession, TaskError } from '@/lib/task-store';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Find-or-create a sprint-board task by its stable external key and set its
 * attributes, from a sync plugin (global scoped token, `manage_projects`).
 * Optionally links a session to the task in the same call.
 */
export async function POST(request: NextRequest) {
  const consequence = 'Unable to upsert task';
  try {
    const gate = await requireProjectToken(request, consequence, 'write');
    if ('response' in gate) return gate.response;
    const parsed = managerTaskSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(consequence, 'task sync / request validation', parsed.error.errors);
    const body = parsed.data;

    const { task, created } = await ensureTaskByExternalKey(
      {
        externalKey: body.external_key,
        title: body.title,
        topicId: body.category_id,
        projectId: body.project_id,
        priority: body.priority,
        expectedTurns: body.expected_turns,
        dueAt: body.due_at,
      },
      gate.actor,
    );

    let sessionId: string | null = null;
    if (body.session_id) {
      const linked = await linkTaskSession(task.id, body.session_id, gate.actor);
      if (!linked) return NextResponse.json({ error: `${consequence}: task sync / session lookup - session_id does not exist`, code: 'NOT_FOUND' }, { status: 404 });
      sessionId = linked.id;
    }

    return NextResponse.json({ task_id: task.id, created, session_id: sessionId }, { status: created ? 201 : 200 });
  } catch (error) {
    if (error instanceof TaskError) {
      return NextResponse.json({ error: `${consequence}: ${error.message}`, code: 'INVALID_TASK_REFERENCE' }, { status: error.status });
    }
    logError({ consequence, moduleProcess: 'task sync / upsert task', cause: 'task find-or-create failed', error });
    return NextResponse.json({ error: `${consequence}: task sync / upsert task - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
