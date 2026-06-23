import { NextRequest, NextResponse } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { configuredAdminToken, storeAdminToken, validateAdminToken } from '@/lib/admin-token';
import { ensureDatabaseSchema } from '@/lib/setup-schema';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest) {
  try {
    await ensureDatabaseSchema();

    if (configuredAdminToken()) {
      return NextResponse.json(
        {
          error: 'Unable to update admin token: admin settings / custom token update - PCP_ADMIN_TOKEN is configured and owns the admin credential',
          code: 'ENV_TOKEN_CONFIGURED',
        },
        { status: 409 },
      );
    }

    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json(
        { error: authResult.error, code: authResult.code },
        { status: authResult.status },
      );
    }

    const body = await request.json().catch(() => ({}));
    const newToken = typeof body.new_token === 'string' ? body.new_token.trim() : '';
    const validationError = validateAdminToken(newToken);
    if (validationError) {
      return NextResponse.json(
        {
          error: `Unable to update admin token: admin settings / custom token validation - ${validationError}`,
          code: 'INVALID_TOKEN',
        },
        { status: 400 },
      );
    }

    await storeAdminToken(newToken);
    return NextResponse.json({ success: true, message: 'Admin token updated. Use the new token on the next login.' });
  } catch (error) {
    logError({
      consequence: 'Unable to update admin token',
      moduleProcess: 'admin settings / custom token update',
      cause: 'token verification, request parsing, or token hash storage failed',
      error,
    });
    return NextResponse.json(
      {
        error: 'Unable to update admin token: admin settings / custom token update - token verification, request parsing, or token hash storage failed',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 },
    );
  }
}