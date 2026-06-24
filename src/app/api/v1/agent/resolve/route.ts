import { NextResponse, NextRequest } from 'next/server';
import { buildDiscovery } from '@/lib/agent-discovery';
import { parseRecordingUrl } from '@/lib/recording-url';
import { agentErrorBody } from '@/lib/agent-errors';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Resolve a recording URL to its protocol descriptor:
 * `GET /api/v1/agent/resolve?url=<recording-url>`. Lets an agent that was handed
 * only a URL discover the upload routes without parsing the path itself.
 */
export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl.searchParams.get('url');
    const parsed = parseRecordingUrl(url);

    if (!parsed) {
      const { status, body } = agentErrorBody('NOT_FOUND', {
        message:
          'Unable to resolve recording URL: agent protocol discovery / url parameter parsing — the url query parameter was missing or not a /r/<sessionId> recording URL.',
        next_steps: ['Pass ?url=<recording-url> where the recording URL looks like https://<domain>/r/<sessionId>.'],
      });
      return NextResponse.json(body, { status });
    }

    const { status, body } = await buildDiscovery(parsed.sessionId, request.nextUrl.origin);
    return NextResponse.json(body, { status });
  } catch (error) {
    logError({
      consequence: 'Unable to resolve recording URL',
      moduleProcess: 'agent protocol discovery / resolve recording URL',
      cause: 'url parsing, session lookup, or protocol construction failed',
      error,
    });
    const { status, body } = agentErrorBody('INTERNAL_ERROR');
    return NextResponse.json(body, { status });
  }
}
