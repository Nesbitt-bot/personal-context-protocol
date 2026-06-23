import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appInstance, uiAuth } from '@/lib/schema';
import { ensureDatabaseSchema } from '@/lib/setup-schema';
import { generateToken, generateSalt, hashToken } from '@/lib/auth';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';


export async function POST() {
  try {
    await ensureDatabaseSchema();
    // Check if already initialized
    const [existing] = await db.select().from(appInstance);
    if (existing) {
      return NextResponse.json(
        {
          error: 'Setup already completed: app setup / initialization guard - database is already initialized',
          code: 'ALREADY_INITIALIZED',
        },
        { status: 400 },
      );
    }

    // Generate UI token
    const uiToken = generateToken();
    const salt = generateSalt();
    const tokenHash = await hashToken(uiToken, salt);

    // Create app instance and UI auth in transaction
    await db.transaction(async (tx) => {
      // Insert app instance
      await tx.insert(appInstance).values({
        id: 'instance_1',
        initializedAt: new Date(),
        version: '0.1.0',
      });

      // Insert UI auth
      await tx.insert(uiAuth).values({
        id: 'ui_1',
        tokenHash,
        salt,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

    });

    // Return token ONLY in this response
    return NextResponse.json({
      success: true,
      ui_token: uiToken,
      message: 'Store this token securely. It will not be shown again.',
    });
  } catch (error) {
    logError({
      consequence: 'Unable to initialize database',
      moduleProcess: 'app setup / database initialization transaction',
      cause: 'schema bootstrap, app instance insert, or UI auth insert failed',
      error,
    });
    return NextResponse.json(
      {
        error: 'Unable to initialize database: app setup / database initialization transaction - schema bootstrap, app instance insert, or UI auth insert failed',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 },
    );
  }
}
