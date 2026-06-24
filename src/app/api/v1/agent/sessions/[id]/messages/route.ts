import { NextResponse, NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/middleware';
import { appendMessagesToSession } from '@/lib/recording-store';
import { appendMessagesSchema } from '@/lib/validations';
import { agentErrorBody, mapAuthFailure } from '@/lib/agent-errors';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Agent message recording: `POST /api/v1/agent/sessions/<id>/messages` with
 * Authorization: Bearer <access-token>. Append-only; returns the structured
 * agent envelope on failure.
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
    const validation = appendMessagesSchema.safeParse(body);
    if (!validation.success) {
      const { status, body: errorBody } = agentErrorBody('VALIDATION_ERROR', {
        next_steps: [
          'Send { "messages": [ { "role": "user|assistant|system|tool|correction", "content": "..." } ] }.',
          'Stay within the protocol limits (max_messages_per_request, max_content_chars).',
        ],
      });
      return NextResponse.json({ ...errorBody, details: validation.error.errors }, { status });
    }

    const result = await appendMessagesToSession({
      sessionId: params.id,
      messages: validation.data.messages,
      suggestedTitle: validation.data.suggested_session_title,
      canRenameSession: authResult.canRenameSession,
      actor: `ai:${authResult.tokenId}`,
    });

    if (!result.ok) {
      const { status, body: errorBody } = agentErrorBody(result.code);
      return NextResponse.json(errorBody, { status });
    }

    return NextResponse.json(result);
  } catch (error) {
    logError({
      consequence: 'Unable to append messages',
      moduleProcess: 'agent session recording / append message request',
      cause: 'token verification, validation, or message persistence failed',
      error,
    });
    const { status, body } = agentErrorBody('INTERNAL_ERROR');
    return NextResponse.json(body, { status });
  }
}
