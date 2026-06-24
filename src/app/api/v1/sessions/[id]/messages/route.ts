import { NextResponse, NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/middleware';
import { appendMessagesToSession } from '@/lib/recording-store';
import { logError } from '@/lib/logging';
import { appendMessagesSchema } from '@/lib/validations';

export const dynamic = 'force-dynamic';

const FAILURE_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  SESSION_ARCHIVED: 403,
  FORBIDDEN: 403,
};

const FAILURE_MESSAGE: Record<string, string> = {
  NOT_FOUND: 'Unable to append messages: AI session recording / session lookup - session not found',
  SESSION_ARCHIVED: 'Unable to append messages: AI session recording / session state check - session is archived',
  FORBIDDEN: 'Unable to rename session: AI session recording / token permission check - this token cannot suggest session titles',
};

/**
 * Legacy scoped message append: `POST /api/v1/sessions/<id>/messages`. Retained
 * for back-compat; new agents should use `/api/v1/agent/sessions/<id>/messages`.
 * Delegates to the shared store so message append and title normalization share
 * one code path.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const authResult = await verifySessionToken(request, params.id);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const body = await request.json();
    const validation = appendMessagesSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Unable to append messages: AI session recording / request validation - invalid request body',
          code: 'VALIDATION_ERROR',
          details: validation.error.errors,
        },
        { status: 400 },
      );
    }

    const result = await appendMessagesToSession({
      sessionId: params.id,
      messages: validation.data.messages,
      suggestedTitle: validation.data.suggested_session_title,
      canRenameSession: authResult.canRenameSession,
      actor: `ai:${authResult.tokenId}`,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: FAILURE_MESSAGE[result.code], code: result.code === 'SESSION_ARCHIVED' ? 'FORBIDDEN' : result.code },
        { status: FAILURE_STATUS[result.code] },
      );
    }

    return NextResponse.json({
      success: true,
      messages: result.messages.map((message) => ({
        id: message.id,
        session_id: params.id,
        ordinal: message.ordinal,
        created_at: result.session.last_message_at,
      })),
      session: {
        id: params.id,
        title: result.session.title,
        last_message_at: result.session.last_message_at,
      },
    });
  } catch (error) {
    logError({
      consequence: 'Unable to append messages',
      moduleProcess: 'AI session recording / append message transaction',
      cause: 'session lookup, ordinal calculation, message insert, session update, or audit event insert failed',
      error,
    });
    return NextResponse.json(
      {
        error: 'Unable to append messages: AI session recording / append message transaction - session lookup, ordinal calculation, message insert, session update, or audit event insert failed',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 },
    );
  }
}
