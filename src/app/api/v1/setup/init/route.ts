import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appInstance } from '@/lib/schema';
import { ensureDatabaseSchema } from '@/lib/setup-schema';
import { generateToken } from '@/lib/auth';
import {
  DEPLOYMENT_GUIDE_URL,
  adminCredentialExists,
  configuredAdminToken,
  generatedAdminTokenMessage,
  logGeneratedAdminToken,
  storeAdminToken,
  validateAdminToken,
} from '@/lib/admin-token';
import { logError } from '@/lib/logging';
import { APP_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await ensureDatabaseSchema();

    const deployToken = configuredAdminToken();
    const validationError = deployToken ? validateAdminToken(deployToken) : '';
    if (validationError) {
      return NextResponse.json(
        {
          error: `Unable to initialize database: deployment credential setup / PCP_ADMIN_TOKEN validation - ${validationError}. Open the deployment guide and update PCP_ADMIN_TOKEN, or remove it to let PCP generate a first-login token.`,
          code: 'INVALID_ADMIN_TOKEN',
          docs_url: DEPLOYMENT_GUIDE_URL,
        },
        { status: 400 },
      );
    }

    const [existing] = await db.select().from(appInstance);
    if (existing) {
      if (deployToken) {
        await storeAdminToken(deployToken, 'env');
        return NextResponse.json({
          success: true,
          initialized: true,
          ui_token: null,
          env_admin_token_configured: true,
          message: 'Admin token loaded from PCP_ADMIN_TOKEN. Use that value to log in.',
        });
      }

      const hasCredential = await adminCredentialExists();
      if (!hasCredential) {
        const recoveryToken = generateToken();
        await storeAdminToken(recoveryToken, 'deploy');
        logGeneratedAdminToken(recoveryToken, 'The database was initialized, but the admin credential row was missing.');
        return NextResponse.json({
          success: true,
          initialized: true,
          ui_token: recoveryToken,
          credential_recovered: true,
          env_admin_token_configured: false,
          message: `Admin credential was missing. ${generatedAdminTokenMessage()}`,
        });
      }

      return NextResponse.json(
        {
          error: 'Setup already completed: app setup / initialization guard - database is already initialized',
          code: 'ALREADY_INITIALIZED',
        },
        { status: 400 },
      );
    }

    const uiToken = deployToken || generateToken();
    await storeAdminToken(uiToken, deployToken ? 'env' : 'deploy');
    if (!deployToken) {
      logGeneratedAdminToken(uiToken, 'PCP_ADMIN_TOKEN was not configured during fallback setup initialization.');
    }
    await db.insert(appInstance).values({
      id: 'instance_1',
      initializedAt: new Date(),
      version: APP_VERSION,
    });

    return NextResponse.json({
      success: true,
      initialized: true,
      ui_token: deployToken ? null : uiToken,
      env_admin_token_configured: Boolean(deployToken),
      message: deployToken
        ? 'Admin token loaded from PCP_ADMIN_TOKEN. Use that value to log in.'
        : generatedAdminTokenMessage(),
    });
  } catch (error) {
    logError({
      consequence: 'Unable to initialize database',
      moduleProcess: 'app setup / database initialization transaction',
      cause: 'schema bootstrap, admin token storage, or app instance insert failed',
      error,
    });
    return NextResponse.json(
      {
        error: 'Unable to initialize database: app setup / database initialization transaction - schema bootstrap, admin token storage, or app instance insert failed',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 },
    );
  }
}
