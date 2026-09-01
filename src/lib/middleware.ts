import { NextResponse, NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { logError } from '@/lib/logging';
import { ADMIN_TOKEN_RECOVERY_URL, DEPLOYMENT_GUIDE_URL, configuredAdminToken } from '@/lib/admin-token';
import { resolveScopedToken } from '@/lib/scoped-token';

/**
 * Verify UI token and return session info
 */
export async function verifyUiToken(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      error: 'Unable to access: user authentication / bearer header validation - missing or invalid authorization header',
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
      if (configuredAdminToken()) {
        return {
          error: `Unable to log in: deployment credential setup / PCP_ADMIN_TOKEN reconciliation - PCP_ADMIN_TOKEN is configured, but the admin credential was not initialized in the database. Open the app home page to run setup again, or follow the deployment guide: ${DEPLOYMENT_GUIDE_URL}`,
          code: 'ADMIN_CREDENTIAL_NOT_INITIALIZED',
          status: 409,
          docsUrl: DEPLOYMENT_GUIDE_URL,
        } as const;
      }

      return {
        error: 'Unable to log in: first-run admin credential / deploy initialization - no admin credential exists yet. Deploy initialization should create it automatically when DATABASE_URL is configured; use the login page fallback initializer or redeploy after fixing DATABASE_URL.',
        code: 'SETUP_REQUIRED',
        status: 409,
        docsUrl: DEPLOYMENT_GUIDE_URL,
      } as const;
    }

    const isValid = await verifyToken(token, stored.tokenHash, stored.salt);

    if (!isValid) {
      const guidance = configuredAdminToken()
        ? 'this value does not match PCP_ADMIN_TOKEN. PCP_ADMIN_TOKEN owns the admin credential, so log in with exactly that env-var value (32+ characters), or change the env var and redeploy.'
        : 'no PCP_ADMIN_TOKEN is set, so the active token is the one PCP generated and printed once in your deploy/build logs (search for "generated first-login admin token"). On each deploy a fresh token is generated and the old one stops working. To choose your own stable token instead, set PCP_ADMIN_TOKEN (32+ characters) and redeploy — the env var then owns the credential and overrides the generated one.';
      return {
        error: `Unable to log in: user authentication / UI token verification - the admin token is incorrect. ${guidance}`,
        code: 'UNAUTHORIZED',
        status: 401,
        docsUrl: ADMIN_TOKEN_RECOVERY_URL,
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
    logError({
      consequence: 'Unable to verify token',
      moduleProcess: 'user authentication / UI token verification',
      cause: 'database lookup, token hash verification, or last-used update failed',
      error,
    });
    return {
      error: 'Unable to verify token: user authentication / UI token verification - internal error occurred',
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
      error: 'Unable to authenticate: session token validation / bearer header validation - missing or invalid authorization header',
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
        error: 'Unable to authenticate: session token validation / token prefix lookup - invalid token prefix',
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
        error: 'Unable to authenticate: session token validation / token hash verification - invalid token signature',
        code: 'UNAUTHORIZED',
        status: 401,
      } as const;
    }

    // Check revoked
    if (stored.revoked) {
      return {
        error: 'Unable to authenticate: session token validation / revocation check - token has been revoked',
        code: 'TOKEN_REVOKED',
        status: 401,
      } as const;
    }

    // Check expired
    if (stored.expiresAt && stored.expiresAt < new Date()) {
      return {
        error: 'Unable to authenticate: session token validation / expiration check - token has expired',
        code: 'TOKEN_EXPIRED',
        status: 401,
      } as const;
    }

    // Check session match
    if (stored.sessionId !== sessionId) {
      return {
        error: `Unable to access: session token validation / session scope check - token is scoped to session ${stored.sessionId}, not ${sessionId}`,
        code: 'SESSION_MISMATCH',
        status: 403,
      } as const;
    }

    // Verify token
    const isValid = await verifyToken(token, stored.tokenHash, stored.salt);
    
    if (!isValid) {
      return {
        error: 'Unable to authenticate: session token validation / final token hash verification - invalid token signature',
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
    logError({
      consequence: 'Unable to verify token',
      moduleProcess: 'session token validation / scoped token verification',
      cause: 'token prefix lookup, hash verification, scope check, or last-used update failed',
      error,
    });
    return {
      error: 'Unable to verify token: session token validation / scoped token verification - internal error occurred',
      code: 'INTERNAL_ERROR',
      status: 500,
    } as const;
  }
}

/**
 * Verify a scoped token (the global token manager layer). On success returns
 * the resolved token with its scope and permissions so routes can enforce
 * least privilege without touching the admin credential.
 */
export async function verifyScopedToken(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      error: 'Unable to authenticate: scoped token validation / bearer header validation - missing or invalid authorization header',
      code: 'UNAUTHORIZED',
      status: 401,
    } as const;
  }

  const token = authHeader.substring(7);
  const resolved = await resolveScopedToken(token);
  if (!resolved) {
    return {
      error: 'Unable to authenticate: scoped token validation / token resolution - invalid, revoked, or expired scoped token',
      code: 'UNAUTHORIZED',
      status: 401,
    } as const;
  }

  return { success: true, token: resolved } as const;
}
