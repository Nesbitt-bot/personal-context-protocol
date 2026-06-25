import { NextResponse, NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/middleware';
import { appendMessagesToSession, recordCompaction } from '@/lib/recording-store';
import { appendMessagesSchema, createCompactSchema } from '@/lib/validations';
import { parseIngestPayload } from '@/lib/ingest';
import { agentErrorBody, mapAuthFailure } from '@/lib/agent-errors';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Forgiving agent ingestion: `POST /api/v1/agent/sessions/<id>/ingest`. Accepts
 * { messages }, <PCP_APPEND>/<PCP_COMPACT> blocks, ChatML-like arrays, or raw
 * transcript text, and normalizes into messages or a compaction. On failure it
 * returns structured retry guidance, not a vague error.
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

    const rawBody = await request.text().catch(() => '');
    const parsed = parseIngestPayload(rawBody);

    if (parsed.kind === 'error') {
      const { status, body } = agentErrorBody('UNPARSEABLE_PAYLOAD', { message: undefined });
      return NextResponse.json({ ...body, reason: parsed.reason }, { status });
    }

    if (parsed.kind === 'compact' || parsed.kind === 'mixed') {
      const validation = createCompactSchema.safeParse(parsed.compact);
      if (!validation.success) {
        const { status, body } = agentErrorBody('VALIDATION_ERROR');
        return NextResponse.json({ ...body, details: validation.error.errors }, { status });
      }
      const stored = await recordCompaction({
        sessionId: params.id,
        compact: parsed.compact,
        actor: `ai:${authResult.tokenId}`,
      });
      if (!stored.ok) {
        const { status, body } = agentErrorBody(stored.code);
        return NextResponse.json(body, { status });
      }
      if (parsed.kind === 'compact') {
        return NextResponse.json({ ...stored, ingested_as: 'compact' });
      }
      // mixed: also append the messages below.
    }

    const messagesToAppend = parsed.kind === 'mixed' || parsed.kind === 'messages' ? parsed.messages : [];
    if (messagesToAppend.length === 0) {
      return NextResponse.json({ ok: true, ingested_as: 'compact' });
    }

    const validation = appendMessagesSchema.safeParse({ messages: messagesToAppend });
    if (!validation.success) {
      const { status, body } = agentErrorBody('VALIDATION_ERROR', {
        next_steps: ['Keep each message under max_content_chars and send at most max_messages_per_request per call.'],
      });
      return NextResponse.json({ ...body, details: validation.error.errors }, { status });
    }

    const result = await appendMessagesToSession({
      sessionId: params.id,
      messages: validation.data.messages,
      canRenameSession: authResult.canRenameSession,
      actor: `ai:${authResult.tokenId}`,
    });
    if (!result.ok) {
      const { status, body } = agentErrorBody(result.code);
      return NextResponse.json(body, { status });
    }
    return NextResponse.json({ ...result, ingested_as: parsed.kind === 'mixed' ? 'mixed' : 'messages' });
  } catch (error) {
    logError({
      consequence: 'Unable to ingest content',
      moduleProcess: 'agent session recording / forgiving ingest request',
      cause: 'token verification, payload parsing, or persistence failed',
      error,
    });
    const { status, body } = agentErrorBody('INTERNAL_ERROR');
    return NextResponse.json(body, { status });
  }
}
