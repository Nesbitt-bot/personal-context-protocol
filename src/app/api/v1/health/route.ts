import { NextResponse } from 'next/server';
import { logError } from '@/lib/logging';
import { APP_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Basic health check; database health is kept separate from process health.
    return NextResponse.json({
      status: 'ok',
      version: APP_VERSION,
      database: 'pending',
    });
  } catch (error) {
    logError({
      consequence: 'Unable to report health status',
      moduleProcess: 'system health / health endpoint response',
      cause: 'health response construction failed',
      error,
    });
    return NextResponse.json(
      {
        error: 'Unable to report health status: system health / health endpoint response - health response construction failed',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 },
    );
  }
}
