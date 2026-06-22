import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { appInstance, uiAuth } from '@/lib/schema';
import { generateToken, generateSalt, hashToken, createId } from '@/lib/auth';
import { sql } from 'drizzle-orm';

export async function POST(request: Request) {
  try {
    // Check if already initialized
    const [existing] = await db.select().from(appInstance);
    if (existing) {
      return NextResponse.json(
        {
          error: 'Setup already completed: app initialization — database is already initialized',
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

      // Create initial migration record
      const { schemaMigrations } = await import('@/lib/schema');
      await tx.insert(schemaMigrations).values({
        version: '001_initial',
        appliedAt: new Date(),
        checksum: 'initial_schema',
      });
    });

    // Return token ONLY in this response
    return NextResponse.json({
      success: true,
      ui_token: uiToken,
      message: 'Store this token securely. It will not be shown again.',
    });
  } catch (error) {
    console.error('Setup init error:', error);
    return NextResponse.json(
      {
        error: 'Unable to initialize: app setup — database transaction failed',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 },
    );
  }
}
