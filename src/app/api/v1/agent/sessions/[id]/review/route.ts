import { NextResponse, NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { messages } from '@/lib/schema';
import { logError } from '@/lib/logging';
import { agentErrorBody, mapAuthFailure } from '@/lib/agent-errors';
import { asc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * Agent-scoped message read. Unlike the admin `/sessions/:id/review` (UI token),
 * this endpoint accepts the session access token and returns only that session's
 * messages. This is how an agent discovers the conversation history it should
 * include when recording.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const authResult = await verifySessionToken(request, params.id);
    if ('error' in authResult) {
      const { status, body } = mapAuthFailure(authResult);
      return NextResponse.json(body, { status });
    }

    const allMessages = await db
      .select({
        id: messages.id,
        ordinal: messages.ordinal,
        role: messages.role,
        content: messages.content,
        provider: messages.provider,
        base_model: messages.BaseModel,
        observed_at: messages.observedAt,
      })
      .from(messages)
      .where(eq(messages.sessionId, params.id))
      .orderBy(asc(messages.ordinal));

    return NextResponse.json({ session_id: params.id, message_count: allMessages.length, messages: allMessages });
  } catch (error) {
    logError({
      consequence: 'Unable to read messages',
      moduleProcess: 'agent session recording / scoped message read',
      cause: 'token verification or message query failed',
      error,
    });
    const { status, body } = agentErrorBody('INTERNAL_ERROR');
    return NextResponse.json(body, { status });
  }
}
