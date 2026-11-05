import { NextRequest, NextResponse } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { ensureDatabaseSchema } from '@/lib/setup-schema';
import { AdminTokenConfigurationError, adminTokenSource, reconcileConfiguredAdminToken } from '@/lib/admin-token';
import { logError } from '@/lib/logging';
import { breakGlassEnabled, BREAK_GLASS_ENV } from '@/lib/oidc-config';

export const dynamic = 'force-dynamic';

/**
 * Break-glass admin-token check used by the login page. Disabled (401) unless
 * PCP_BREAK_GLASS_ADMIN_LOGIN=1; normal sign-in goes through Casdoor.
 */
export async function GET(request: NextRequest) {
  if (!breakGlassEnabled()) {
    return NextResponse.json(
      {
        error: `Unable to log in: break-glass admin login / feature flag - admin-token login is disabled on this deployment; sign in with Casdoor instead (an operator can enable it with ${BREAK_GLASS_ENV}=1)`,
        code: 'BREAK_GLASS_DISABLED',
      },
      { status: 401 },
    );
  }

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
