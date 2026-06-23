import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appInstance } from '@/lib/schema';
import { ensureDatabaseSchema } from '@/lib/setup-schema';
import { generateToken } from '@/lib/auth';
import { adminCredentialExists, configuredAdminToken, storeAdminToken, validateAdminToken } from '@/lib/admin-token';
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
          error: `Unable to initialize database: app setup / configured admin token validation - ${validationError}`,
          code: 'INVALID_ADMIN_TOKEN',
        },
        { status: 400 },
      );
    }

    const [existing] = await db.select().from(appInstance);
    if (existing) {
      if (deployToken) {
        await storeAdminToken(deployToken);
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
        await storeAdminToken(recoveryToken);
        return NextResponse.json({
          success: true,
          initialized: true,
          ui_token: recoveryToken,
          credential_recovered: true,
          env_admin_token_configured: false,
          message: 'Admin credential was missing. Store this replacement token securely; it will not be shown again.',
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
    await storeAdminToken(uiToken);
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
        : 'Store this token securely. It will not be shown again.',
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
