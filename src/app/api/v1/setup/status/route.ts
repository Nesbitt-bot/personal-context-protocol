import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appInstance } from '@/lib/schema';
import { ensureDatabaseSchema } from '@/lib/setup-schema';
import { AdminTokenConfigurationError, reconcileConfiguredAdminToken } from '@/lib/admin-token';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';


export async function GET() {
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
      });
    }
    
    return NextResponse.json({
      initialized: true,
      version: instance.version,
      needs_migration: false,
      env_admin_token_configured: tokenState.configured,
    });
  } catch (error) {
    if (error instanceof AdminTokenConfigurationError) {
      return NextResponse.json(
        {
          initialized: false,
          needs_migration: true,
          env_admin_token_configured: true,
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
      error: 'Unable to check setup status: app setup / initialization status database probe - database unavailable or schema bootstrap failed',
      code: 'SETUP_STATUS_PROBE_FAILED',
    });
  }
}
