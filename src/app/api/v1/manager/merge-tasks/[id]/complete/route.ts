import { NextRequest, NextResponse } from 'next/server';
import { requireProjectToken, validationError } from '@/lib/project-access';
import { completeMergeSchema } from '@/lib/project-validations';
import { completeMergeTask, mergeTaskJson } from '@/lib/sync-store';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/** An agent posts its merged value; PCP applies it and resolves the conflict. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to complete merge task';
  try {
    const gate = await requireProjectToken(request, consequence, 'write');
    if ('response' in gate) return gate.response;
    const parsed = completeMergeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(consequence, 'merge tasks / request validation', parsed.error.errors);
    const outcome = await completeMergeTask(params.id, parsed.data.value, gate.actor);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
    return NextResponse.json({ merge_task: mergeTaskJson(outcome.task), applied: outcome.applied });
  } catch (error) {
    logError({ consequence, moduleProcess: 'merge tasks / complete', cause: 'merged value write failed', error });
    return NextResponse.json({ error: `${consequence}: merge tasks / complete - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
