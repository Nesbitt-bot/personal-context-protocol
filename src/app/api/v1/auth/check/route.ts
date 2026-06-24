import { NextRequest, NextResponse } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { ensureDatabaseSchema } from '@/lib/setup-schema';
import { AdminTokenConfigurationError, adminTokenSource, reconcileConfiguredAdminToken } from '@/lib/admin-token';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseSchema();
    const tokenState = await reconcileConfiguredAdminToken();
    const authResult = await verifyUiToken(request);

    if ('error' in authResult) {
      return NextResponse.json(
        { error: authResult.error, code: authResult.code, docs_url: 'docsUrl' in authResult ? authResult.docsUrl : undefined },
        { status: authResult.status },
      );
    }

    const source = await adminTokenSource();
    return NextResponse.json({
      success: true,
      user_id: authResult.userId,
      env_admin_token_configured: tokenState.configured,
      ui_token_source: source,
    });
  } catch (error) {
    if (error instanceof AdminTokenConfigurationError) {
      return NextResponse.json(
        {
          error: `Unable to log in: deployment credential setup / PCP_ADMIN_TOKEN validation - ${error.message}. Open the deployment guide and update PCP_ADMIN_TOKEN, or remove it to let PCP generate a first-login token.`,
          code: error.code,
          docs_url: error.docsUrl,
        },
        { status: 400 },
      );
    }

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
