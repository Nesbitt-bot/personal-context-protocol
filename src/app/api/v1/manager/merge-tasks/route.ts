import { NextRequest, NextResponse } from 'next/server';
import { requireProjectToken } from '@/lib/project-access';
import { listMergeTasks, mergeTaskJson } from '@/lib/sync-store';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/** Pending AI merge tasks for an agent to work (manage_projects). */
export async function GET(request: NextRequest) {
  const consequence = 'Unable to list merge tasks';
  try {
    const gate = await requireProjectToken(request, consequence, 'write');
    if ('response' in gate) return gate.response;
    const status = request.nextUrl.searchParams.get('status') || 'pending';
    if (!['pending', 'completed', 'cancelled'].includes(status)) {
      return NextResponse.json({ error: `${consequence}: merge tasks / query validation - status must be pending, completed or cancelled`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const rows = await listMergeTasks(status as 'pending');
    return NextResponse.json({ merge_tasks: rows.map(mergeTaskJson) });
  } catch (error) {
    logError({ consequence, moduleProcess: 'merge tasks / list', cause: 'merge task query failed', error });
    return NextResponse.json({ error: `${consequence}: merge tasks / list - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
