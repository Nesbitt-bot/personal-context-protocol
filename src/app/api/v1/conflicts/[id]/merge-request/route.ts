import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { mergeTaskJson, requestMergeTask } from '@/lib/sync-store';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * "AI merge suggestion": store a pending merge task holding both versions for
 * an agent to resolve later (GET /api/v1/manager/merge-tasks). PCP never calls
 * a model. Admin only; idempotent per conflict.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to request AI merge';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const outcome = await requestMergeTask(params.id, `human:${auth.actor.userId}`);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
    return NextResponse.json({ merge_task: mergeTaskJson(outcome.task), created: outcome.created }, { status: outcome.created ? 201 : 200 });
  } catch (error) {
    logError({ consequence, moduleProcess: 'sync conflicts / merge request', cause: 'merge task insert failed', error });
    return NextResponse.json({ error: `${consequence}: sync conflicts / merge request - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
