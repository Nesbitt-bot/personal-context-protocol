import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { sessionTokens, sessions, events } from '@/lib/schema';
import { generateToken, generateSalt, hashToken, createId } from '@/lib/auth';
import { logError } from '@/lib/logging';
import { createTokenSchema } from '@/lib/validations';
import { DEFAULT_EXPIRATION, resolveExpiresAt, tokenStatus } from '@/lib/token-expiration';
import { buildRecordingUrl, resolveAppBaseUrl } from '@/lib/recording-url';
import { buildAgentInstruction } from '@/lib/agent-protocol';
import { desc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/** List token metadata (never the secret) so the UI can show status. */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const rows = await db
      .select({
        id: sessionTokens.id,
        name: sessionTokens.name,
        canRenameSession: sessionTokens.canRenameSession,
        revoked: sessionTokens.revoked,
        createdAt: sessionTokens.createdAt,
        expiresAt: sessionTokens.expiresAt,
        lastUsedAt: sessionTokens.lastUsedAt,
      })
      .from(sessionTokens)
      .where(eq(sessionTokens.sessionId, params.id))
      .orderBy(desc(sessionTokens.createdAt));

    const now = new Date();
    const tokens = rows.map((row) => ({
      id: row.id,
      name: row.name,
      can_rename_session: row.canRenameSession,
      status: tokenStatus({ revoked: row.revoked, expiresAt: row.expiresAt }, now),
      created_at: row.createdAt,
      expires_at: row.expiresAt,
      last_used_at: row.lastUsedAt,
    }));

    return NextResponse.json({ tokens });
  } catch (error) {
    logError({
      consequence: 'Unable to list tokens',
      moduleProcess: 'session token administration / token list query',
      cause: 'token metadata query failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to list tokens: session token administration / token list query - token metadata query failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
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

    const { can_rename_session } = validation.data;
    const expiresIn = validation.data.expires_in || DEFAULT_EXPIRATION;

    // Verify session exists
    const [session] = await db
      .select({ id: sessions.id, title: sessions.title })
      .from(sessions)
      .where(eq(sessions.id, params.id));

    if (!session) {
      return NextResponse.json(
        {
          error: 'Unable to create token: session token administration / session lookup - session not found',
          code: 'NOT_FOUND',
        },
        { status: 404 },
      );
    }

    const name = validation.data.name?.trim() || `${session.title} access token`;
    const now = new Date();
    const expiresAt = resolveExpiresAt(expiresIn, now);

    const token = generateToken();
    const salt = generateSalt();
    const tokenHash = await hashToken(token, salt);
    const tokenId = createId('tok');

    await db.insert(sessionTokens).values({
      id: tokenId,
      sessionId: params.id,
      tokenHash,
      salt,
      name,
      canRenameSession: can_rename_session || false,
      tokenPrefix: token.substring(0, 16),
      expiresAt,
      createdAt: now,
    });

    await db.insert(events).values({
      id: createId('evt'),
      sessionId: params.id,
      action: 'token.created',
      actor: 'human',
      detailsJson: { token_name: name, token_id: tokenId, expires_in: expiresIn },
      createdAt: now,
    });

    const baseUrl = resolveAppBaseUrl(request.nextUrl.origin);
    const recordingUrl = buildRecordingUrl(baseUrl, params.id);

    // The token (and the instruction containing it) are returned ONLY here.
    return NextResponse.json({
      success: true,
      token,
      access_token: token,
      recording_url: recordingUrl,
      instruction: buildAgentInstruction(recordingUrl, token),
      session_id: params.id,
      name,
      can_rename_session: can_rename_session || false,
      expires_in: expiresIn,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      status: 'active',
      created_at: now.toISOString(),
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
