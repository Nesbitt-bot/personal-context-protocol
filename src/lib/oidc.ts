import crypto from 'crypto';
import { createLocalJWKSet, jwtVerify, errors as joseErrors } from 'jose';
import type { JSONWebKeySet, JWTPayload } from 'jose';
import type { OidcConfig } from './oidc-config';

/**
 * OpenID Connect relying-party helpers for Casdoor (authorization code flow
 * with state + nonce + PKCE S256). ID tokens are verified with `jose` against
 * the issuer's JWKS: signature (asymmetric algorithms only), issuer, audience,
 * expiry/not-before, and nonce. Network access goes through the injectable
 * `fetch` so tests can stand in for the identity provider.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[];
}

export class OidcError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// Asymmetric only: an HS* token would be "signed" with the client secret and
// `none` is unsigned. Casdoor signs ID tokens with RS256 by default.
export const ALLOWED_ID_TOKEN_ALGS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];
const CLOCK_TOLERANCE_SECONDS = 60;
const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const JWKS_TTL_MS = 10 * 60 * 1000;
const NETWORK_TIMEOUT_MS = 8000;

const discoveryCache = new Map<string, { value: OidcDiscovery; at: number }>();
const jwksCache = new Map<string, { value: JSONWebKeySet; at: number }>();

/** Test hook: forget cached discovery documents and key sets. */
export function resetOidcCaches() {
  discoveryCache.clear();
  jwksCache.clear();
}

function normalizeIssuer(value: string) {
  return value.replace(/\/+$/, '');
}

export function base64url(bytes: Buffer) {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomUrlToken(byteLength = 32) {
  return base64url(crypto.randomBytes(byteLength));
}

export function pkceChallenge(verifier: string) {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

/** Constant-time comparison of two strings of possibly different length. */
export function safeEqual(a: string, b: string) {
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right) && a.length === b.length;
}

async function fetchJson(fetchImpl: FetchLike, url: string, init: RequestInit | undefined, what: string) {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
  } catch (error) {
    const cause = error instanceof Error ? error.name : 'unknown error';
    throw new OidcError('OIDC_PROVIDER_UNREACHABLE', `${what} request failed (${cause})`);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== 'object') {
    throw new OidcError('OIDC_PROVIDER_ERROR', `${what} returned HTTP ${response.status} without a usable JSON body`);
  }
  return body as Record<string, unknown>;
}

export async function discover(config: OidcConfig, fetchImpl: FetchLike = fetch): Promise<OidcDiscovery> {
  const cached = discoveryCache.get(config.issuer);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.value;

  const body = await fetchJson(fetchImpl, `${config.issuer}/.well-known/openid-configuration`, undefined, 'OIDC discovery');
  const doc = body as unknown as OidcDiscovery;
  for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (typeof doc[key] !== 'string' || !doc[key]) {
      throw new OidcError('OIDC_DISCOVERY_INVALID', `OIDC discovery document is missing ${key}`);
    }
  }
  // Mix-up defence: the discovery document must describe the configured issuer.
  if (normalizeIssuer(doc.issuer) !== normalizeIssuer(config.issuer)) {
    throw new OidcError('OIDC_DISCOVERY_INVALID', 'OIDC discovery issuer does not match PCP_OIDC_ISSUER');
  }
  discoveryCache.set(config.issuer, { value: doc, at: Date.now() });
  return doc;
}

export interface AuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export function buildAuthorizationRequest(config: OidcConfig, discovery: OidcDiscovery): AuthorizationRequest {
  const state = randomUrlToken();
  const nonce = randomUrlToken();
  const codeVerifier = randomUrlToken(48);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', pkceChallenge(codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return { url: url.toString(), state, nonce, codeVerifier };
}

/** Exchange an authorization code (with its PKCE verifier) for an ID token. */
export async function exchangeCode(
  config: OidcConfig,
  discovery: OidcDiscovery,
  code: string,
  codeVerifier: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  const methods = discovery.token_endpoint_auth_methods_supported;
  const useBasic = Array.isArray(methods) && methods.includes('client_secret_basic') && !methods.includes('client_secret_post');
  if (useBasic) {
    const basic = Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  } else {
    form.set('client_id', config.clientId);
    form.set('client_secret', config.clientSecret);
  }

  const body = await fetchJson(fetchImpl, discovery.token_endpoint, { method: 'POST', headers, body: form.toString() }, 'OIDC token exchange');
  // Casdoor may report failures as HTTP 200 with an `error` field.
  if (typeof body.error === 'string' && body.error) {
    throw new OidcError('OIDC_TOKEN_EXCHANGE_FAILED', 'identity provider rejected the authorization code');
  }
  if (typeof body.id_token !== 'string' || !body.id_token) {
    throw new OidcError('OIDC_TOKEN_EXCHANGE_FAILED', 'token response did not include an id_token');
  }
  return body.id_token;
}

async function loadJwks(jwksUri: string, fetchImpl: FetchLike, force: boolean): Promise<JSONWebKeySet> {
  const cached = jwksCache.get(jwksUri);
  if (!force && cached && Date.now() - cached.at < JWKS_TTL_MS) return cached.value;
  const body = await fetchJson(fetchImpl, jwksUri, undefined, 'OIDC JWKS');
  if (!Array.isArray(body.keys)) throw new OidcError('OIDC_JWKS_INVALID', 'JWKS document has no keys array');
  const value = body as unknown as JSONWebKeySet;
  jwksCache.set(jwksUri, { value, at: Date.now() });
  return value;
}

export interface VerifiedIdentity {
  sub: string;
  displayName: string;
  email: string | null;
  groups: string[];
}

/**
 * Verify an ID token and return the identity it asserts. Throws OidcError on
 * any failure; callers must treat every throw as "not signed in".
 */
export async function verifyIdToken(
  config: OidcConfig,
  discovery: OidcDiscovery,
  idToken: string,
  expectedNonce: string,
  fetchImpl: FetchLike = fetch,
): Promise<VerifiedIdentity> {
  let payload: JWTPayload;
  const verify = async (force: boolean) => {
    const keySet = createLocalJWKSet(await loadJwks(discovery.jwks_uri, fetchImpl, force));
    const result = await jwtVerify(idToken, keySet, {
      issuer: discovery.issuer,
      audience: config.clientId,
      algorithms: ALLOWED_ID_TOKEN_ALGS,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['sub', 'exp', 'iat'],
    });
    return result.payload;
  };

  try {
    try {
      payload = await verify(false);
    } catch (error) {
      // Key rotation: refetch the key set once when no cached key matches.
      if (error instanceof joseErrors.JWKSNoMatchingKey) payload = await verify(true);
      else throw error;
    }
  } catch (error) {
    if (error instanceof OidcError) throw error;
    const reason = error instanceof joseErrors.JWTExpired ? 'ID token is expired'
      : error instanceof joseErrors.JWTClaimValidationFailed ? `ID token claim "${error.claim}" is invalid`
        : error instanceof joseErrors.JOSEAlgNotAllowed ? 'ID token uses a disallowed signing algorithm'
          : 'ID token signature or format is invalid';
    throw new OidcError('OIDC_ID_TOKEN_INVALID', reason);
  }

  // With multiple audiences the authorized party must be this client.
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.clientId) {
    throw new OidcError('OIDC_ID_TOKEN_INVALID', 'ID token authorized party (azp) is not this client');
  }
  if (typeof payload.nonce !== 'string' || !safeEqual(payload.nonce, expectedNonce)) {
    throw new OidcError('OIDC_ID_TOKEN_INVALID', 'ID token nonce does not match the login request');
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new OidcError('OIDC_ID_TOKEN_INVALID', 'ID token has no subject');
  }

  const claim = (name: string) => (typeof payload[name] === 'string' ? (payload[name] as string).trim() : '');
  const groups = Array.isArray(payload.groups)
    ? (payload.groups as unknown[]).filter((group): group is string => typeof group === 'string')
    : [];

  return {
    sub: payload.sub,
    displayName: (claim('displayName') || claim('name') || claim('preferred_username') || payload.sub).slice(0, 200),
    email: claim('email') || null,
    groups,
  };
}

export type GroupDecision = { allowed: true; isAdmin: boolean } | { allowed: false };

/** Sign-in needs the required group; admin is derived from the admin group. */
export function decideGroups(config: OidcConfig, groups: string[]): GroupDecision {
  if (!groups.includes(config.requiredGroup)) return { allowed: false };
  return { allowed: true, isAdmin: groups.includes(config.adminGroup) };
}
