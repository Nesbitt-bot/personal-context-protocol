import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appInstance } from '@/lib/schema';
import { ensureDatabaseSchema } from '@/lib/setup-schema';
import { reconcileConfiguredAdminToken } from '@/lib/admin-token';
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
