import { NextResponse, NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/middleware';
import { dryRunIngest } from '@/lib/ingest';
import { mapAuthFailure } from '@/lib/agent-errors';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Validate a fallback payload without storing it:
 * `POST /api/v1/agent/sessions/<id>/ingest-dry-run`. Returns what it would
 * import, or an actionable structured error. Nothing is written.
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
    const result = dryRunIngest(rawBody);

    if (!result.valid) {
      return NextResponse.json(
        {
          ok: false,
          valid: false,
          code: result.code,
          retryable: true,
          message: result.message,
          next_steps: result.next_steps,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      ok: true,
      valid: true,
      would_import: result.would_import,
      warnings: result.warnings ?? [],
    });
  } catch (error) {
    logError({
      consequence: 'Unable to validate fallback payload',
      moduleProcess: 'agent session recording / ingest dry-run',
      cause: 'token verification or payload validation failed',
      error,
    });
    return NextResponse.json({ ok: false, valid: false, code: 'INTERNAL_ERROR', retryable: true, message: 'Internal error during dry-run validation.' }, { status: 500 });
  }
}
