import { NextResponse, NextRequest } from 'next/server';
import { buildDiscovery } from '@/lib/agent-discovery';
import { agentErrorBody } from '@/lib/agent-errors';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Public protocol descriptor for a session:
 * `GET /api/v1/agent/sessions/<id>/protocol`. No token required — exposes only
 * non-secret routing so an agent can learn where to upload.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { status, body } = await buildDiscovery(params.id, request.nextUrl.origin);
    return NextResponse.json(body, { status });
  } catch (error) {
    logError({
      consequence: 'Unable to return protocol',
      moduleProcess: 'agent protocol discovery / protocol endpoint',
      cause: 'session lookup or protocol construction failed',
      error,
    });
    const { status, body } = agentErrorBody('INTERNAL_ERROR');
    return NextResponse.json(body, { status });
  }
}
