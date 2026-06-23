import { NextRequest, NextResponse } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { ensureDatabaseSchema } from '@/lib/setup-schema';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseSchema();
    const authResult = await verifyUiToken(request);

    if ('error' in authResult) {
      return NextResponse.json(
        { error: authResult.error, code: authResult.code },
        { status: authResult.status },
      );
    }

    return NextResponse.json({ success: true, user_id: authResult.userId });
  } catch (error) {
    logError({
      consequence: 'Unable to verify admin token',
      moduleProcess: 'user authentication / login token check',
      cause: 'schema bootstrap or UI token verification failed',
      error,
    });
    return NextResponse.json(
      {
        error: 'Unable to verify admin token: user authentication / login token check - schema bootstrap or UI token verification failed',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 },
    );
  }
}