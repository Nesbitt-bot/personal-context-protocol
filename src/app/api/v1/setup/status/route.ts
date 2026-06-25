import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appInstance } from '@/lib/schema';
import { ensureDatabaseSchema } from '@/lib/setup-schema';
import { AdminTokenConfigurationError, reconcileConfiguredAdminToken } from '@/lib/admin-token';
import { validateRuntimeConfig } from '@/lib/config';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';


export async function GET() {
  // Secret-free configuration issues, surfaced so the setup UI can show
  // missing/malformed env vars without ever echoing a value.
  const configIssues = validateRuntimeConfig(process.env).issues;
  try {
    await ensureDatabaseSchema();
    const tokenState = await reconcileConfiguredAdminToken();
    // Check if app is initialized
    const [instance] = await db.select().from(appInstance);

    if (!instance) {
      return NextResponse.json({
        initialized: false,
        needs_migration: true,
        env_admin_token_configured: tokenState.configured,
        config_issues: configIssues,
      });
    }

    return NextResponse.json({
      initialized: true,
      version: instance.version,
      needs_migration: false,
      env_admin_token_configured: tokenState.configured,
      config_issues: configIssues,
    });
  } catch (error) {
    if (error instanceof AdminTokenConfigurationError) {
      return NextResponse.json(
        {
          initialized: false,
          needs_migration: true,
          env_admin_token_configured: true,
          config_issues: configIssues,
          error: `Unable to check setup status: deployment credential setup / PCP_ADMIN_TOKEN validation - ${error.message}. Open the deployment guide and update PCP_ADMIN_TOKEN, or remove it to let PCP generate a first-login token.`,
          code: error.code,
          docs_url: error.docsUrl,
        },
        { status: 400 },
      );
    }

    logError({
      consequence: 'Unable to check setup status',
      moduleProcess: 'app setup / initialization status database probe',
      cause: 'schema bootstrap or app_instance lookup failed because the database is unavailable',
      error,
    });
    return NextResponse.json({
      initialized: false,
      needs_migration: true,
      env_admin_token_configured: Boolean(process.env.PCP_ADMIN_TOKEN),
      config_issues: configIssues,
      error: 'Unable to check setup status: app setup / initialization status database probe - database unavailable or schema bootstrap failed',
      code: 'SETUP_STATUS_PROBE_FAILED',
    });
  }
}
