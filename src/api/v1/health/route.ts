import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Basic health check - will be enhanced with DB check
    return NextResponse.json({
      status: 'ok',
      version: '0.1.0',
      database: 'pending',
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Health check failed: internal server — unknown error occurred',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 },
    );
  }
}
