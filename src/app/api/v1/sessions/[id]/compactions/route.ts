import { NextResponse, NextRequest } from 'next/server';
import { authenticateUi, authErrorResponse } from '@/lib/ui-auth';
import { authorizeSession } from '@/lib/session-access';
import { db } from '@/lib/db';
import { compactions } from '@/lib/schema';
import { logError } from '@/lib/logging';
import { desc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * Lists the durable compaction summaries for a session (UI token). Compactions
 * are additional records — they never replace raw messages — and are rendered as
 * first-class readable content in the session workspace.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const authResult = await authenticateUi(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }
    const denied = await authorizeSession(authResult.actor, params.id, 'Unable to list compactions');
    if (denied) return authErrorResponse(denied);

    const rows = await db
      .select({
        id: compactions.id,
        summary: compactions.summary,
        timeline: compactions.timelineJson,
        decisions: compactions.decisionsJson,
        requirements: compactions.requirementsJson,
        open_questions: compactions.openQuestionsJson,
        artifacts: compactions.artifactsJson,
        warnings: compactions.warningsJson,
        provider: compactions.provider,
        base_model: compactions.baseModel,
        created_at: compactions.createdAt,
      })
      .from(compactions)
      .where(eq(compactions.sessionId, params.id))
      .orderBy(desc(compactions.createdAt));

    return NextResponse.json({ compactions: rows });
  } catch (error) {
    logError({
      consequence: 'Unable to list compactions',
      moduleProcess: 'session review / compaction list query',
      cause: 'compaction query failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to list compactions: session review / compaction list query - compaction query failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
