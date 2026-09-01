import { NextResponse, NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { scopedTokens, topics, sessions, events } from '@/lib/schema';
import { createId, generateToken, generateSalt, hashToken } from '@/lib/auth';
import { logError } from '@/lib/logging';
import { createScopedTokenSchema, manageScopedTokenSchema } from '@/lib/validations';
import { DEFAULT_EXPIRATION, resolveExpiresAt, tokenStatus } from '@/lib/token-expiration';
import { normalizePermissions } from '@/lib/scoped-token';
import type { TokenScope } from '@/lib/scoped-token';

export const dynamic = 'force-dynamic';

/** List scoped-token metadata (never the secret) for the global token manager. */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const rows = await db.select().from(scopedTokens).orderBy(scopedTokens.createdAt);
    const now = new Date();
    const tokens = rows.map((row) => ({
      id: row.id,
      name: row.name,
      scope: row.scope,
      folder_id: row.folderId ?? null,
      session_id: row.sessionId ?? null,
      permissions: normalizePermissions(row.permissionsJson, row.scope as TokenScope),
      status: tokenStatus({ revoked: row.revoked, expiresAt: row.expiresAt }, now),
      created_at: row.createdAt,
      expires_at: row.expiresAt,
      last_used_at: row.lastUsedAt,
    }));

    return NextResponse.json({ tokens });
  } catch (error) {
    logError({
      consequence: 'Unable to list scoped tokens',
      moduleProcess: 'scoped token administration / token list query',
      cause: 'scoped token query failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to list scoped tokens: scoped token administration / token list query - scoped token query failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

/** Create a scoped token and return it once. */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const body = await request.json().catch(() => ({}));
    const validation = createScopedTokenSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Unable to create scoped token: scoped token administration / request validation - invalid request body', code: 'VALIDATION_ERROR', details: validation.error.errors },
        { status: 400 },
      );
    }

    const { name, scope, folder_id, session_id, permissions } = validation.data;
    const expiresIn = validation.data.expires_in || DEFAULT_EXPIRATION;

    if (scope === 'folder') {
      const [folder] = await db.select({ id: topics.id }).from(topics).where(eq(topics.id, folder_id!));
      if (!folder) {
        return NextResponse.json({ error: 'Unable to create scoped token: scoped token administration / folder lookup - folder not found', code: 'NOT_FOUND' }, { status: 404 });
      }
    }
    if (scope === 'session') {
      const [session] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, session_id!));
      if (!session) {
        return NextResponse.json({ error: 'Unable to create scoped token: scoped token administration / session lookup - session not found', code: 'NOT_FOUND' }, { status: 404 });
      }
    }

    const token = generateToken();
    const salt = generateSalt();
    const tokenHash = await hashToken(token, salt);
    const tokenId = createId('stk');
    const now = new Date();
    const expiresAt = resolveExpiresAt(expiresIn, now);
    const normalizedPermissions = normalizePermissions(permissions, scope);

    await db.insert(scopedTokens).values({
      id: tokenId,
      tokenHash,
      salt,
      tokenPrefix: token.substring(0, 16),
      name,
      scope,
      folderId: scope === 'folder' ? folder_id : null,
      sessionId: scope === 'session' ? session_id : null,
      permissionsJson: normalizedPermissions as never,
      revoked: false,
      createdAt: now,
      expiresAt,
    });

    await db.insert(events).values({
      id: createId('evt'),
      sessionId: scope === 'session' ? session_id : null,
      topicId: scope === 'folder' ? folder_id : null,
      action: 'token.created',
      actor: 'human',
      detailsJson: { token_id: tokenId, token_name: name, scope, permissions: normalizedPermissions },
      createdAt: now,
    });

    return NextResponse.json({
      success: true,
      token,
      access_token: token,
      id: tokenId,
      name,
      scope,
      folder_id: scope === 'folder' ? folder_id : null,
      session_id: scope === 'session' ? session_id : null,
      permissions: normalizedPermissions,
      expires_in: expiresIn,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      status: 'active',
      created_at: now.toISOString(),
    });
  } catch (error) {
    logError({
      consequence: 'Unable to create scoped token',
      moduleProcess: 'scoped token administration / create scoped token transaction',
      cause: 'folder/session lookup, token hash, token insert, or audit event insert failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to create scoped token: scoped token administration / create scoped token transaction - lookup, hash, insert, or audit event insert failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

/** Rename and/or revoke a scoped token. */
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const body = await request.json().catch(() => ({}));
    const validation = manageScopedTokenSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Unable to update scoped token: scoped token administration / request validation - provide token_id and a new name or revoke: true', code: 'VALIDATION_ERROR', details: validation.error.errors },
        { status: 400 },
      );
    }

    const [token] = await db.select().from(scopedTokens).where(eq(scopedTokens.id, validation.data.token_id));
    if (!token) {
      return NextResponse.json({ error: 'Unable to update scoped token: scoped token administration / token lookup - token not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (validation.data.name !== undefined) {
      await db.update(scopedTokens).set({ name: validation.data.name }).where(eq(scopedTokens.id, token.id));
    }
    if (validation.data.revoke === true && !token.revoked) {
      await db.update(scopedTokens).set({ revoked: true }).where(eq(scopedTokens.id, token.id));
    }

    await db.insert(events).values({
      id: createId('evt'),
      sessionId: token.sessionId,
      topicId: token.folderId,
      action: validation.data.revoke === true ? 'token.revoked' : 'token.renamed',
      actor: 'human',
      detailsJson: { token_id: token.id, token_name: token.name },
      createdAt: new Date(),
    });

    return NextResponse.json({ success: true, id: token.id, revoked: validation.data.revoke === true || token.revoked });
  } catch (error) {
    logError({
      consequence: 'Unable to update scoped token',
      moduleProcess: 'scoped token administration / manage scoped token update',
      cause: 'token lookup, rename/revoke update, or audit event insert failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to update scoped token: scoped token administration / manage scoped token update - lookup, update, or audit event insert failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

/** Permanently delete a scoped token. */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const body = await request.json().catch(() => ({}));
    const tokenId = typeof body.token_id === 'string' ? body.token_id.trim() : '';
    if (!tokenId) {
      return NextResponse.json({ error: 'Unable to delete scoped token: scoped token administration / token_id validation - token_id is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const [token] = await db.select().from(scopedTokens).where(eq(scopedTokens.id, tokenId));
    if (!token) {
      return NextResponse.json({ error: 'Unable to delete scoped token: scoped token administration / token lookup - token not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    await db.delete(scopedTokens).where(eq(scopedTokens.id, token.id));

    await db.insert(events).values({
      id: createId('evt'),
      sessionId: token.sessionId,
      topicId: token.folderId,
      action: 'token.deleted',
      actor: 'human',
      detailsJson: { token_id: token.id, token_name: token.name },
      createdAt: new Date(),
    });

    return NextResponse.json({ success: true, id: token.id, deleted: true });
  } catch (error) {
    logError({
      consequence: 'Unable to delete scoped token',
      moduleProcess: 'scoped token administration / permanent token deletion',
      cause: 'token lookup or delete failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to delete scoped token: scoped token administration / permanent token deletion - token lookup or delete failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
