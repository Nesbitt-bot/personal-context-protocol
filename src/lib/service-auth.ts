import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { serviceCredentials } from './schema';
import { createId, generateSalt, generateToken, hashToken, verifyToken } from './auth';
import { logError } from './logging';

/**
 * Service credentials for channel plugins (OpenClaw, AstrBot ingress).
 *
 * - Format `pcps_<64 hex>`; stored as a salted scrypt hash with a 16-character
 *   lookup prefix, like the other PCP tokens. Shown once at creation.
 * - Accepted ONLY by `/api/v1/service/*`. They are never admin, never a web UI
 *   login, and never an agent recording token.
 * - Each credential lists the principal prefixes it may assert (e.g.
 *   `telegram:`, `openclaw-weixin:` for OpenClaw; `astrbot:` for AstrBot).
 */

export const SERVICE_TOKEN_PREFIX = 'pcps_';
export const PRINCIPAL_PREFIX_PATTERN = /^[a-z][a-z0-9_-]{0,63}:$/;

export interface ResolvedServiceCredential {
  id: string;
  name: string;
  principalPrefixes: string[];
}

export function isValidPrincipalPrefix(value: unknown): value is string {
  return typeof value === 'string' && PRINCIPAL_PREFIX_PATTERN.test(value);
}

/** Whether a credential may assert this principal. */
export function credentialAllowsPrincipal(prefixes: readonly string[], principal: string): boolean {
  return prefixes.some((prefix) => isValidPrincipalPrefix(prefix) && principal.startsWith(prefix));
}

export async function createServiceCredential(name: string, principalPrefixes: string[], expiresAt: Date | null) {
  const token = `${SERVICE_TOKEN_PREFIX}${generateToken()}`;
  const salt = generateSalt();
  const id = createId('svc');
  await db.insert(serviceCredentials).values({
    id,
    name,
    tokenHash: await hashToken(token, salt),
    salt,
    tokenPrefix: token.substring(0, 16),
    principalPrefixesJson: principalPrefixes,
    revoked: false,
    createdAt: new Date(),
    expiresAt,
  });
  return { id, token };
}

export async function resolveServiceToken(token: string, now = new Date()): Promise<ResolvedServiceCredential | null> {
  if (!token.startsWith(SERVICE_TOKEN_PREFIX)) return null;
  const candidates = await db
    .select()
    .from(serviceCredentials)
    .where(eq(serviceCredentials.tokenPrefix, token.substring(0, 16)))
    .limit(10);

  for (const candidate of candidates) {
    if (!(await verifyToken(token, candidate.tokenHash, candidate.salt))) continue;
    if (candidate.revoked) return null;
    if (candidate.expiresAt && candidate.expiresAt.getTime() <= now.getTime()) return null;
    await db.update(serviceCredentials).set({ lastUsedAt: now }).where(eq(serviceCredentials.id, candidate.id));
    const prefixes = Array.isArray(candidate.principalPrefixesJson)
      ? (candidate.principalPrefixesJson as unknown[]).filter(isValidPrincipalPrefix)
      : [];
    return { id: candidate.id, name: candidate.name, principalPrefixes: prefixes };
  }
  return null;
}

export type ServiceAuthResult =
  | { success: true; credential: ResolvedServiceCredential }
  | { error: string; code: string; status: number };

export async function verifyServiceCredential(request: NextRequest): Promise<ServiceAuthResult> {
  const header = request.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return {
      error: 'Unable to access: service credential validation / bearer header validation - missing or invalid authorization header',
      code: 'UNAUTHORIZED',
      status: 401,
    };
  }
  try {
    const credential = await resolveServiceToken(header.substring(7));
    if (!credential) {
      return {
        error: 'Unable to access: service credential validation / token resolution - invalid, revoked, or expired service credential',
        code: 'UNAUTHORIZED',
        status: 401,
      };
    }
    return { success: true, credential };
  } catch (error) {
    logError({ consequence: 'Unable to verify service credential', moduleProcess: 'service credential validation / token resolution', cause: 'credential lookup or hash verification failed', error });
    return {
      error: 'Unable to verify service credential: service credential validation / token resolution - internal error occurred',
      code: 'INTERNAL_ERROR',
      status: 500,
    };
  }
}
