import { NextResponse, NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/middleware';
import { recordCompaction } from '@/lib/recording-store';
import { createCompactSchema } from '@/lib/validations';
import { agentErrorBody, mapAuthFailure } from '@/lib/agent-errors';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Agent compaction: `POST /api/v1/agent/sessions/<id>/compact`. Stores a durable
 * session summary when full message upload is impossible. Compactions are
 * additional records and never replace raw messages.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const authResult = await verifySessionToken(request, params.id);
    if ('error' in authResult) {
      const { status, body } = mapAuthFailure(authResult);
      return NextResponse.json(body, { status });
    }

    const body = await request.json().catch(() => null);
    const validation = createCompactSchema.safeParse(body);
    if (!validation.success) {
      const { status, body: errorBody } = agentErrorBody('VALIDATION_ERROR', {
        next_steps: ['Send { "summary": "...", "decisions": [...], "open_questions": [...] }. Only "summary" is required.'],
      });
      return NextResponse.json({ ...errorBody, details: validation.error.errors }, { status });
    }

    const { summary, timeline, decisions, requirements, open_questions, artifacts, warnings, provider, base_model, metadata } =
      validation.data;

    const result = await recordCompaction({
      sessionId: params.id,
      compact: { summary, timeline, decisions, requirements, open_questions, artifacts, warnings, provider, base_model, metadata },
      actor: `ai:${authResult.tokenId}`,
    });

    if (!result.ok) {
      const { status, body: errorBody } = agentErrorBody(result.code);
      return NextResponse.json(errorBody, { status });
    }

    return NextResponse.json(result);
  } catch (error) {
    logError({
      consequence: 'Unable to record compaction',
      moduleProcess: 'agent session recording / compaction request',
      cause: 'token verification, validation, or compaction persistence failed',
      error,
    });
    const { status, body } = agentErrorBody('INTERNAL_ERROR');
    return NextResponse.json(body, { status });
  }
}
