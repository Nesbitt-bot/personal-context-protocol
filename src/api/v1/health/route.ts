import { NextResponse } from 'next/server';
import { logError } from '@/lib/logging';

export async function GET() {
  try {
    // Basic health check - will be enhanced with DB check
    return NextResponse.json({
      status: 'ok',
      version: '0.1.0',
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
