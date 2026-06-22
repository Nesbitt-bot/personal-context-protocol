import { NextResponse, NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

/**
 * Verify UI token and return session info
 */
export async function verifyUiToken(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      error: 'Unable to access: authentication — missing or invalid authorization header',
      code: 'UNAUTHORIZED',
      status: 401,
    } as const;
  }

  const token = authHeader.substring(7);
  
  // Import here to avoid circular dependencies
  const { db } = await import('@/lib/db');
  const { uiAuth } = await import('@/lib/schema');
  const { verifyToken } = await import('@/lib/auth');

  try {
    const [stored] = await db.select().from(uiAuth);
    
    if (!stored) {
      return {
        error: 'Unable to access: system configuration — UI auth not initialized',
        code: 'INTERNAL_ERROR',
        status: 500,
      } as const;
    }

    const isValid = await verifyToken(token, stored.tokenHash, stored.salt);
    
    if (!isValid) {
      return {
        error: 'Unable to log in: user authentication — invalid UI token',
        code: 'UNAUTHORIZED',
        status: 401,
      } as const;
    }

    // Update last used
    await db
      .update(uiAuth)
      .set({ lastUsedAt: new Date() })
      .where(eq(uiAuth.id, 'ui_1'));

    return {
      success: true,
      userId: 'admin',
    } as const;
  } catch (error) {
    console.error('UI token verification error:', error);
    return {
      error: 'Unable to verify token: authentication — internal error occurred',
      code: 'INTERNAL_ERROR',
      status: 500,
    } as const;
  }
}

/**
 * Verify session token and return session info
 */
export async function verifySessionToken(request: NextRequest, sessionId: string) {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      error: 'Unable to authenticate: session token validation — missing or invalid authorization header',
      code: 'UNAUTHORIZED',
      status: 401,
    } as const;
  }

  const token = authHeader.substring(7);
  const tokenPrefix = token.substring(0, 16); // First 16 chars of token for lookup
  
  const { db } = await import('@/lib/db');
  const { sessionTokens } = await import('@/lib/schema');
  const { verifyToken } = await import('@/lib/auth');

  try {
    // Find candidate tokens by prefix (quick lookup)
    const candidates = await db
      .select()
      .from(sessionTokens)
      .where(eq(sessionTokens.tokenPrefix, tokenPrefix))
      .limit(10);

    if (candidates.length === 0) {
      return {
        error: 'Unable to authenticate: session token validation — invalid token',
        code: 'UNAUTHORIZED',
        status: 401,
      } as const;
    }

    // Find matching token by verifying each candidate
    let stored = null;
    for (const candidate of candidates) {
      const isValid = await verifyToken(token, candidate.tokenHash, candidate.salt);
      if (isValid) {
        stored = candidate;
        break;
      }
    }

    if (!stored) {
      return {
        error: 'Unable to authenticate: session token validation — invalid token',
        code: 'UNAUTHORIZED',
        status: 401,
      } as const;
    }

    // Check revoked
    if (stored.revoked) {
      return {
        error: 'Unable to authenticate: session token validation — token has been revoked',
        code: 'TOKEN_REVOKED',
        status: 401,
      } as const;
    }

    // Check expired
    if (stored.expiresAt && stored.expiresAt < new Date()) {
      return {
        error: 'Unable to authenticate: session token validation — token has expired',
        code: 'TOKEN_EXPIRED',
        status: 401,
      } as const;
    }

    // Check session match
    if (stored.sessionId !== sessionId) {
      return {
        error: `Unable to access: session token validation — token is scoped to session ${stored.sessionId}, not ${sessionId}`,
        code: 'SESSION_MISMATCH',
        status: 403,
      } as const;
    }

    // Verify token
    const isValid = await verifyToken(token, stored.tokenHash, stored.salt);
    
    if (!isValid) {
      return {
        error: 'Unable to authenticate: session token validation — invalid token signature',
        code: 'UNAUTHORIZED',
        status: 401,
      } as const;
    }

    // Update last used
    await db
      .update(sessionTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(sessionTokens.id, stored.id));

    return {
      success: true,
      sessionId: stored.sessionId,
      canRenameSession: stored.canRenameSession,
      tokenId: stored.id,
    } as const;
  } catch (error) {
    console.error('Session token verification error:', error);
    return {
      error: 'Unable to verify token: session token validation — internal error occurred',
      code: 'INTERNAL_ERROR',
      status: 500,
    } as const;
  }
}
