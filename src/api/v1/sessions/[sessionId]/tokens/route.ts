import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { sessionTokens, sessions, events } from '@/lib/schema';
import { generateToken, generateSalt, hashToken, createId } from '@/lib/auth';
import { logError } from '@/lib/logging';
import { createTokenSchema } from '@/lib/validations';
import { eq } from 'drizzle-orm';

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    // Verify UI token
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const body = await request.json();
    const validation = createTokenSchema.safeParse(body);
    
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Unable to create token: session token administration / request validation - invalid request body',
          code: 'VALIDATION_ERROR',
          details: validation.error.errors,
        },
        { status: 400 },
      );
    }

    const { name, can_rename_session } = validation.data;

    // Verify session exists
    const [session] = await db
      .select({ id: sessions.id, topicId: sessions.topicId })
      .from(sessions)
      .where(eq(sessions.id, params.sessionId));

    if (!session) {
      return NextResponse.json(
        {
          error: 'Unable to create token: session token administration / session lookup - session not found',
          code: 'NOT_FOUND',
        },
        { status: 404 },
      );
    }

    // Generate token
    const token = generateToken();
    const salt = generateSalt();
    const tokenHash = await hashToken(token, salt);
    const tokenId = createId('tok');

    // Insert token
    await db.insert(sessionTokens).values({
      id: tokenId,
      sessionId: params.sessionId,
      tokenHash,
      salt,
      name,
      canRenameSession: can_rename_session || false,
      tokenPrefix: token.substring(0, 16),
      createdAt: new Date(),
    });

    // Log event
    await db.insert(events).values({
      id: createId('evt'),
      sessionId: params.sessionId,
      action: 'token.created',
      actor: 'human',
      detailsJson: { token_name: name, token_id: tokenId },
      createdAt: new Date(),
    });

    // Return token ONLY in this response
    return NextResponse.json({
      success: true,
      token,
      session_id: params.sessionId,
      name,
      can_rename_session: can_rename_session || false,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    logError({
      consequence: 'Unable to create token',
      moduleProcess: 'session token administration / create scoped token transaction',
      cause: 'session lookup, token hash, token insert, or audit event insert failed',
      error,
    });
    return NextResponse.json(
      {
        error: 'Unable to create token: session token administration / create scoped token transaction - session lookup, token hash, token insert, or audit event insert failed',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 },
    );
  }
}
