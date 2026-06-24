import { NextResponse, NextRequest } from 'next/server';
import { buildDiscovery } from '@/lib/agent-discovery';
import { logError } from '@/lib/logging';
import { agentErrorBody } from '@/lib/agent-errors';

export const dynamic = 'force-dynamic';

/**
 * Public recording-URL entry point. An agent fetches `/r/<sessionId>` to
 * discover the protocol and upload routes using only the recording URL.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  try {
    const { status, body } = await buildDiscovery(params.sessionId, request.nextUrl.origin);
    return NextResponse.json(body, { status });
  } catch (error) {
    logError({
      consequence: 'Unable to resolve recording URL',
      moduleProcess: 'agent protocol discovery / recording URL lookup',
      cause: 'session lookup or protocol construction failed',
      error,
    });
    const { status, body } = agentErrorBody('INTERNAL_ERROR');
    return NextResponse.json(body, { status });
  }
}
