import crypto from 'crypto';
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
 * - Kinds (migration 014):
 *   - `channel`: channel plugins; the only kind `/api/v1/service/*` accepts.
 *     May never assert the reserved `astrbot:` prefix.
 *   - `ingress`: the AstrBot relay plugin. Exactly the `astrbot:` prefix;
 *     accepted only by the broker routes, always together with an HMAC
 *     signature made with its signing key (see deriveIngressSigningKey).
 *   - `broker`: the loopback broker process. Asserts nothing itself; it
 *     forwards signed ingress requests and names the channel credential
 *     (`delegate`) whose tools may read its turn grants.
 */

export const SERVICE_TOKEN_PREFIX = 'pcps_';
export const PRINCIPAL_PREFIX_PATTERN = /^[a-z][a-z0-9_-]{0,63}:$/;

export const CREDENTIAL_KINDS = ['channel', 'ingress', 'broker'] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];
/** Principals of this prefix may only come from a signed AstrBot stamp. */
export const INGRESS_PREFIX = 'astrbot:';

export interface ResolvedServiceCredential {
  id: string;
  name: string;
  principalPrefixes: string[];
  kind: CredentialKind;
  delegateCredentialId: string | null;
}

/**
 * Shape rules per kind; returns an error message or null. Mirrored by
 * scripts/pcp-operator.js (checked in tests/broker.test.ts).
 */
export function credentialShapeError(kind: CredentialKind, prefixes: readonly string[], delegateCredentialId: string | null): string | null {
  if (!CREDENTIAL_KINDS.includes(kind)) return 'unknown credential kind';
  if (prefixes.some((prefix) => !isValidPrincipalPrefix(prefix))) return 'principal prefixes must look like "platform:"';
  if (kind === 'channel') {
    if (prefixes.length === 0) return 'a channel credential needs at least one principal prefix';
    if (prefixes.includes(INGRESS_PREFIX)) return `the ${INGRESS_PREFIX} prefix is reserved for the AstrBot ingress credential`;
    if (delegateCredentialId) return 'only a broker credential has a delegate';
  }
  if (kind === 'ingress') {
    if (prefixes.length !== 1 || prefixes[0] !== INGRESS_PREFIX) return `an ingress credential asserts exactly the ${INGRESS_PREFIX} prefix`;
    if (delegateCredentialId) return 'only a broker credential has a delegate';
  }
  if (kind === 'broker' && prefixes.length > 0) return 'a broker credential asserts no principals';
  return null;
}

/**
 * HMAC key the AstrBot plugin signs stamps with. Derived from the instance
 * secret and the credential id, so it is never stored; the operator CLI
 * delivers it once, next to the ingress token.
 */
export function deriveIngressSigningKey(credentialId: string, instanceSecret = process.env.PCP_INSTANCE_SECRET || ''): string {
  if (instanceSecret.trim().length < 32) throw new Error('PCP_INSTANCE_SECRET is not configured');
  return crypto.createHmac('sha256', instanceSecret).update(`pcp-astrbot-ingress-signing:v1:${credentialId}`).digest('hex');
}

export function isValidPrincipalPrefix(value: unknown): value is string {
  return typeof value === 'string' && PRINCIPAL_PREFIX_PATTERN.test(value);
}

/** Whether a credential may assert this principal. */
export function credentialAllowsPrincipal(prefixes: readonly string[], principal: string): boolean {
  return prefixes.some((prefix) => isValidPrincipalPrefix(prefix) && principal.startsWith(prefix));
}

export async function createServiceCredential(
  name: string,
  principalPrefixes: string[],
  expiresAt: Date | null,
  options: { kind?: CredentialKind; delegateCredentialId?: string | null } = {},
) {
  const kind = options.kind ?? 'channel';
  const delegateCredentialId = options.delegateCredentialId ?? null;
  const shapeError = credentialShapeError(kind, principalPrefixes, delegateCredentialId);
  if (shapeError) throw new Error(`Unable to create service credential: ${shapeError}`);
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
    kind,
    delegateCredentialId,
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
    const kind = (CREDENTIAL_KINDS as readonly string[]).includes(candidate.kind) ? candidate.kind as CredentialKind : 'channel';
    let prefixes = Array.isArray(candidate.principalPrefixesJson)
      ? (candidate.principalPrefixesJson as unknown[]).filter(isValidPrincipalPrefix)
      : [];
    // Defence in depth: the reserved prefix only ever counts for ingress.
    if (kind !== 'ingress') prefixes = prefixes.filter((prefix) => prefix !== INGRESS_PREFIX);
    if (kind === 'ingress') prefixes = prefixes.filter((prefix) => prefix === INGRESS_PREFIX);
    if (kind === 'broker') prefixes = [];
    return { id: candidate.id, name: candidate.name, principalPrefixes: prefixes, kind, delegateCredentialId: candidate.delegateCredentialId ?? null };
  }
  return null;
}

export type ServiceAuthResult =
  | { success: true; credential: ResolvedServiceCredential }
  | { error: string; code: string; status: number };

/** Verify a bearer service token of one of `kinds` (default: channel only). */
export async function verifyServiceToken(header: string | null, kinds: readonly CredentialKind[] = ['channel']): Promise<ServiceAuthResult> {
  if (!header || !header.startsWith('Bearer ')) {
    return {
      error: 'Unable to access: service credential validation / bearer header validation - missing or invalid authorization header',
      code: 'UNAUTHORIZED',
      status: 401,
    };
  }
  try {
    const credential = await resolveServiceToken(header.substring(7));
    if (credential && !kinds.includes(credential.kind)) {
      return {
        error: 'Unable to access: service credential validation / kind check - this credential kind is not accepted by this route',
        code: 'UNAUTHORIZED',
        status: 401,
      };
    }
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

export async function verifyServiceCredential(request: NextRequest, kinds: readonly CredentialKind[] = ['channel']): Promise<ServiceAuthResult> {
  return verifyServiceToken(request.headers.get('authorization'), kinds);
}
