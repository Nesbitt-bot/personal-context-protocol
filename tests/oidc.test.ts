import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { KeyLike } from 'jose';
import { breakGlassEnabled, readOidcConfig, OidcConfig } from '../src/lib/oidc-config';
import {
  buildAuthorizationRequest,
  decideGroups,
  discover,
  exchangeCode,
  OidcDiscovery,
  OidcError,
  pkceChallenge,
  resetOidcCaches,
  verifyIdToken,
} from '../src/lib/oidc';
import { sanitizeReturnTo } from '../src/lib/web-session';

const ISSUER = 'https://auth.example.test';
const ENV = {
  PCP_OIDC_ISSUER: ISSUER,
  PCP_OIDC_CLIENT_ID: 'pcp-client',
  PCP_OIDC_CLIENT_SECRET: 'client-secret-value-used-for-hs256-attack',
  PCP_OIDC_REDIRECT_URI: 'https://pcp.example.test/auth/callback',
  PCP_OIDC_REQUIRED_GROUP: 'trance-0/app-pcp',
  PCP_OIDC_ADMIN_GROUP: 'trance-0/admin-pcp',
};

const DISCOVERY: OidcDiscovery = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/login/oauth/authorize`,
  token_endpoint: `${ISSUER}/api/login/oauth/access_token`,
  jwks_uri: `${ISSUER}/.well-known/jwks`,
};

function config(): OidcConfig {
  const result = readOidcConfig(ENV);
  if (!result.enabled) throw new Error('test config should be valid');
  return result.config;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('OIDC configuration (fail closed)', () => {
  it('is disabled and lists every missing variable when nothing is set', () => {
    const result = readOidcConfig({});
    expect(result.enabled).toBe(false);
    if (!result.enabled) expect(result.problems).toHaveLength(6);
  });

  it('is disabled when any single variable is missing', () => {
    for (const key of Object.keys(ENV)) {
      const env: Record<string, string> = { ...ENV };
      delete env[key];
      expect(readOidcConfig(env).enabled).toBe(false);
    }
  });

  it('rejects a plain-http issuer outside loopback and a wrong callback path', () => {
    expect(readOidcConfig({ ...ENV, PCP_OIDC_ISSUER: 'http://auth.example.test' }).enabled).toBe(false);
    expect(readOidcConfig({ ...ENV, PCP_OIDC_REDIRECT_URI: 'https://pcp.example.test/callback' }).enabled).toBe(false);
  });

  it('accepts a complete configuration', () => {
    const result = readOidcConfig(ENV);
    expect(result.enabled).toBe(true);
    if (result.enabled) expect(result.config.appOrigin).toBe('https://pcp.example.test');
  });

  it('break-glass admin login is off unless explicitly enabled', () => {
    expect(breakGlassEnabled({})).toBe(false);
    expect(breakGlassEnabled({ PCP_BREAK_GLASS_ADMIN_LOGIN: '0' })).toBe(false);
    expect(breakGlassEnabled({ PCP_BREAK_GLASS_ADMIN_LOGIN: 'yes' })).toBe(false);
    expect(breakGlassEnabled({ PCP_BREAK_GLASS_ADMIN_LOGIN: '1' })).toBe(true);
    expect(breakGlassEnabled({ PCP_BREAK_GLASS_ADMIN_LOGIN: 'true' })).toBe(true);
  });
});

describe('authorization request', () => {
  it('uses code flow with fresh state, nonce and an S256 PKCE challenge', () => {
    const a = buildAuthorizationRequest(config(), DISCOVERY);
    const b = buildAuthorizationRequest(config(), DISCOVERY);
    const url = new URL(a.url);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('pcp-client');
    expect(url.searchParams.get('redirect_uri')).toBe(ENV.PCP_OIDC_REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe(a.state);
    expect(url.searchParams.get('nonce')).toBe(a.nonce);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge(a.codeVerifier));
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.codeVerifier.length).toBeGreaterThanOrEqual(43);
  });
});

describe('discovery', () => {
  beforeEach(() => resetOidcCaches());

  it('rejects a discovery document for a different issuer', async () => {
    const fetchImpl = async () => jsonResponse({ ...DISCOVERY, issuer: 'https://evil.example.test' });
    await expect(discover(config(), fetchImpl)).rejects.toMatchObject({ code: 'OIDC_DISCOVERY_INVALID' });
  });

  it('accepts the configured issuer', async () => {
    const fetchImpl = async () => jsonResponse(DISCOVERY);
    await expect(discover(config(), fetchImpl)).resolves.toMatchObject({ issuer: ISSUER });
  });
});

describe('token exchange', () => {
  it('sends the PKCE verifier and client credentials', async () => {
    let sent: URLSearchParams | null = null;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      sent = new URLSearchParams(String(init?.body));
      return jsonResponse({ id_token: 'header.payload.sig' });
    };
    await expect(exchangeCode(config(), DISCOVERY, 'the-code', 'the-verifier', fetchImpl)).resolves.toBe('header.payload.sig');
    expect(sent!.get('code')).toBe('the-code');
    expect(sent!.get('code_verifier')).toBe('the-verifier');
    expect(sent!.get('grant_type')).toBe('authorization_code');
    expect(sent!.get('client_id')).toBe('pcp-client');
  });

  it('treats an error body (even with HTTP 200) as failure', async () => {
    const fetchImpl = async () => jsonResponse({ error: 'invalid_grant' });
    await expect(exchangeCode(config(), DISCOVERY, 'c', 'v', fetchImpl)).rejects.toBeInstanceOf(OidcError);
  });
});

describe('ID token verification', () => {
  let privateKey: KeyLike;
  let otherKey: KeyLike;
  let jwks: { keys: unknown[] };
  const fetchJwks = async () => jsonResponse(jwks);

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    const jwk = await exportJWK(pair.publicKey);
    jwks = { keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] };
    otherKey = (await generateKeyPair('RS256')).privateKey;
  });

  beforeEach(() => resetOidcCaches());

  function token(overrides: Record<string, unknown> = {}, opts: { key?: KeyLike; exp?: string | number; iss?: string; aud?: string } = {}) {
    return new SignJWT({ nonce: 'n-1', name: 'alice', groups: ['trance-0/app-pcp'], ...overrides })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject('casdoor-sub-1')
      .setIssuer(opts.iss ?? ISSUER)
      .setAudience(opts.aud ?? 'pcp-client')
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '5m')
      .sign(opts.key ?? privateKey);
  }

  it('accepts a valid token and returns the identity and groups', async () => {
    const identity = await verifyIdToken(config(), DISCOVERY, await token(), 'n-1', fetchJwks);
    expect(identity).toMatchObject({ sub: 'casdoor-sub-1', displayName: 'alice', groups: ['trance-0/app-pcp'] });
  });

  it('rejects a wrong issuer', async () => {
    await expect(verifyIdToken(config(), DISCOVERY, await token({}, { iss: 'https://evil.example.test' }), 'n-1', fetchJwks))
      .rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
  });

  it('rejects a wrong audience', async () => {
    await expect(verifyIdToken(config(), DISCOVERY, await token({}, { aud: 'another-app' }), 'n-1', fetchJwks))
      .rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
  });

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    await expect(verifyIdToken(config(), DISCOVERY, await token({}, { exp: past }), 'n-1', fetchJwks))
      .rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID', message: 'ID token is expired' });
  });

  it('rejects a nonce mismatch (replayed token)', async () => {
    await expect(verifyIdToken(config(), DISCOVERY, await token(), 'n-other', fetchJwks))
      .rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
  });

  it('rejects a token signed by an unknown key', async () => {
    await expect(verifyIdToken(config(), DISCOVERY, await token({}, { key: otherKey }), 'n-1', fetchJwks))
      .rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
  });

  it('rejects HS256 tokens signed with the client secret (algorithm confusion)', async () => {
    const hs = await new SignJWT({ nonce: 'n-1', groups: ['trance-0/admin-pcp', 'trance-0/app-pcp'] })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setSubject('attacker').setIssuer(ISSUER).setAudience('pcp-client').setIssuedAt().setExpirationTime('5m')
      .sign(new TextEncoder().encode(ENV.PCP_OIDC_CLIENT_SECRET));
    await expect(verifyIdToken(config(), DISCOVERY, hs, 'n-1', fetchJwks)).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
  });

  it('rejects unsigned (alg=none) tokens', async () => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${enc({ alg: 'none' })}.${enc({ sub: 'x', iss: ISSUER, aud: 'pcp-client', nonce: 'n-1', iat: now, exp: now + 300 })}.`;
    await expect(verifyIdToken(config(), DISCOVERY, unsigned, 'n-1', fetchJwks)).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
  });

  it('treats a token without a groups claim as having no groups', async () => {
    const identity = await verifyIdToken(config(), DISCOVERY, await token({ groups: undefined }), 'n-1', fetchJwks);
    expect(identity.groups).toEqual([]);
    expect(decideGroups(config(), identity.groups)).toEqual({ allowed: false });
  });
});

describe('group decision', () => {
  it('denies sign-in without the required group, even for admin-group members', () => {
    expect(decideGroups(config(), [])).toEqual({ allowed: false });
    expect(decideGroups(config(), ['trance-0/admin-pcp'])).toEqual({ allowed: false });
    expect(decideGroups(config(), ['trance-0/app-pcp-extra'])).toEqual({ allowed: false });
  });

  it('derives admin from the admin group', () => {
    expect(decideGroups(config(), ['trance-0/app-pcp'])).toEqual({ allowed: true, isAdmin: false });
    expect(decideGroups(config(), ['trance-0/app-pcp', 'trance-0/admin-pcp'])).toEqual({ allowed: true, isAdmin: true });
  });
});

describe('post-login redirect sanitizing', () => {
  it('keeps same-origin paths', () => {
    expect(sanitizeReturnTo('/dashboard?session=ses_1')).toBe('/dashboard?session=ses_1');
    expect(sanitizeReturnTo('/claim')).toBe('/claim');
  });

  it('rejects open-redirect shapes', () => {
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '', null, '/auth/callback', '/a\nb']) {
      expect(sanitizeReturnTo(bad as string | null)).toBe('/dashboard');
    }
  });
});
