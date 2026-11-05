/**
 * End-to-end identity checks against a real PostgreSQL database, calling the
 * Next.js route handlers directly with a stand-in Casdoor (stubbed fetch).
 *
 * Skipped unless PCP_TEST_DATABASE_URL points at a DISPOSABLE database whose
 * name contains "test" — the suite truncates every PCP table. Example:
 *
 *   PCP_TEST_DATABASE_URL=postgresql://pcp:pw@db:5432/pcp_test npm run test:run
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { KeyLike } from 'jose';

const TEST_DB = process.env.PCP_TEST_DATABASE_URL || '';
const enabled = Boolean(TEST_DB) && /test/i.test(new URL(TEST_DB || 'postgres://x/none').pathname);
if (enabled) process.env.DATABASE_URL = TEST_DB;

const ISSUER = 'https://idp.example.test';
const ORIGIN = 'https://pcp.example.test';
const ADMIN_TOKEN = 'break-glass-admin-token-for-tests-0123456789';
const OIDC_ENV = {
  PCP_OIDC_ISSUER: ISSUER,
  PCP_OIDC_CLIENT_ID: 'pcp-client',
  PCP_OIDC_CLIENT_SECRET: 'pcp-client-secret',
  PCP_OIDC_REDIRECT_URI: `${ORIGIN}/auth/callback`,
  PCP_OIDC_REQUIRED_GROUP: 'trance-0/app-pcp',
  PCP_OIDC_ADMIN_GROUP: 'trance-0/admin-pcp',
};

type Handler = (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<Response>;
interface Browser { session: string; csrf: string; }

describe.skipIf(!enabled)('identity, ownership and claims (database)', () => {
  let privateKey: KeyLike;
  let jwks: unknown;
  // What the fake IdP puts in the next ID token.
  let nextIdentity: { sub: string; name: string; groups: string[]; nonce?: string } = { sub: '', name: '', groups: [] };
  let routes: Record<string, Record<string, Handler>> = {};
  let lib: {
    db: typeof import('../src/lib/db')['db'];
    sql: typeof import('drizzle-orm')['sql'];
    createClaim: typeof import('../src/lib/claims')['createClaim'];
    storeAdminToken: typeof import('../src/lib/admin-token')['storeAdminToken'];
  };
  let alice: Browser;
  let bob: Browser;
  let admin: Browser;

  function request(url: string, opts: { method?: string; browser?: Browser; csrf?: boolean; bearer?: string; body?: unknown; cookies?: Record<string, string> } = {}) {
    const headers: Record<string, string> = {};
    const cookies: Record<string, string> = { ...(opts.cookies || {}) };
    if (opts.browser) {
      cookies['__Host-pcp_session'] = opts.browser.session;
      if (opts.csrf !== false) headers['x-pcp-csrf'] = opts.browser.csrf;
    }
    const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookieHeader) headers.cookie = cookieHeader;
    if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    return new NextRequest(new URL(url, ORIGIN), {
      method: opts.method || 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  }

  async function call(route: string, method: string, url: string, opts: Parameters<typeof request>[1] = {}, params: Record<string, string> = {}) {
    const res = await routes[route][method](request(url, { ...opts, method }), { params });
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    return { res, body };
  }

  function cookieValue(res: Response, name: string) {
    const all = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const match = all.find((c) => c.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1).split(';')[0]) : undefined;
  }

  async function signIn(identity: { sub: string; name: string; groups: string[] }, existing?: Browser) {
    const start = await routes.login.GET(request('/auth/login?next=/dashboard'), { params: {} });
    expect(start.status).toBe(303);
    const authorize = new URL(start.headers.get('location')!);
    const stateCookie = cookieValue(start, '__Host-pcp_oidc')!;
    nextIdentity = { ...identity, nonce: authorize.searchParams.get('nonce')! };
    const cookies: Record<string, string> = { '__Host-pcp_oidc': stateCookie };
    if (existing) cookies['__Host-pcp_session'] = existing.session;
    const callback = await routes.callback.GET(
      request(`/auth/callback?code=code-1&state=${authorize.searchParams.get('state')}`, { cookies }),
      { params: {} },
    );
    return { callback, authorize, stateCookie, browser: { session: cookieValue(callback, '__Host-pcp_session') || '', csrf: cookieValue(callback, '__Host-pcp_csrf') || '' } };
  }

  beforeAll(async () => {
    Object.assign(process.env, OIDC_ENV);
    delete process.env.PCP_BREAK_GLASS_ADMIN_LOGIN;
    delete process.env.PCP_ADMIN_TOKEN;

    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] };

    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      if (url === `${ISSUER}/.well-known/openid-configuration`) {
        return json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` });
      }
      if (url === `${ISSUER}/jwks`) return json(jwks);
      if (url === `${ISSUER}/token`) {
        const form = new URLSearchParams(String(init?.body));
        if (!form.get('code_verifier')) return json({ error: 'invalid_request' });
        const idToken = await new SignJWT({ nonce: nextIdentity.nonce, name: nextIdentity.name, groups: nextIdentity.groups })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setSubject(nextIdentity.sub).setIssuer(ISSUER).setAudience('pcp-client').setIssuedAt().setExpirationTime('5m')
          .sign(privateKey);
        return json({ access_token: 'unused', id_token: idToken });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const { db } = await import('../src/lib/db');
    const { sql } = await import('drizzle-orm');
    const { ensureDatabaseSchema } = await import('../src/lib/setup-schema');
    const { createClaim } = await import('../src/lib/claims');
    const { storeAdminToken } = await import('../src/lib/admin-token');
    lib = { db, sql, createClaim, storeAdminToken };

    await ensureDatabaseSchema();
    await db.execute(sql.raw(`TRUNCATE claim_attempts, claims, identities, web_sessions, oidc_login_states, session_links,
      scoped_tokens, session_tokens, messages, compactions, events, sessions, topics, users, ui_auth CASCADE`));
    await storeAdminToken(ADMIN_TOKEN, 'env');

    routes = {
      login: await import('../src/app/auth/login/route'),
      callback: await import('../src/app/auth/callback/route'),
      logout: await import('../src/app/auth/logout/route'),
      me: await import('../src/app/api/v1/auth/me/route'),
      check: await import('../src/app/api/v1/auth/check/route'),
      sessions: await import('../src/app/api/v1/sessions/route'),
      session: await import('../src/app/api/v1/sessions/[id]/route'),
      tokens: await import('../src/app/api/v1/sessions/[id]/tokens/route'),
      claims: await import('../src/app/api/v1/sessions/[id]/claims/route'),
      redeem: await import('../src/app/api/v1/claims/redeem/route'),
      topics: await import('../src/app/api/v1/topics/route'),
      agentMessages: await import('../src/app/api/v1/agent/sessions/[id]/messages/route'),
    } as unknown as Record<string, Record<string, Handler>>;
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('anonymous callers get 401 from UI APIs', async () => {
    expect((await call('sessions', 'GET', '/api/v1/sessions')).res.status).toBe(401);
    expect((await call('me', 'GET', '/api/v1/auth/me')).res.status).toBe(401);
    expect((await call('session', 'GET', '/api/v1/sessions/ses_x', {}, { id: 'ses_x' })).res.status).toBe(401);
  });

  it('break-glass admin token is rejected unless explicitly enabled', async () => {
    const disabled = await call('sessions', 'GET', '/api/v1/sessions', { bearer: ADMIN_TOKEN });
    expect(disabled.res.status).toBe(401);
    expect(disabled.body.code).toBe('BREAK_GLASS_DISABLED');
    expect((await call('check', 'GET', '/api/v1/auth/check', { bearer: ADMIN_TOKEN })).res.status).toBe(401);

    process.env.PCP_BREAK_GLASS_ADMIN_LOGIN = '1';
    try {
      expect((await call('sessions', 'GET', '/api/v1/sessions', { bearer: ADMIN_TOKEN })).res.status).toBe(200);
      expect((await call('sessions', 'GET', '/api/v1/sessions', { bearer: 'wrong-token-value-wrong-token-value' })).res.status).toBe(401);
    } finally {
      delete process.env.PCP_BREAK_GLASS_ADMIN_LOGIN;
    }
  });

  it('login is disabled (fail closed) when OIDC configuration is missing', async () => {
    delete process.env.PCP_OIDC_CLIENT_SECRET;
    try {
      const res = await routes.login.GET(request('/auth/login'), { params: {} });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toContain('auth_error=OIDC_DISABLED');
    } finally {
      process.env.PCP_OIDC_CLIENT_SECRET = OIDC_ENV.PCP_OIDC_CLIENT_SECRET;
    }
  });

  it('a signed-in Casdoor user without the app group is denied at the callback', async () => {
    const { callback, browser } = await signIn({ sub: 'sub-outsider', name: 'outsider', groups: ['trance-0/other'] });
    expect(callback.status).toBe(303);
    expect(callback.headers.get('location')).toBe(`${ORIGIN}/login?auth_error=GROUP_REQUIRED`);
    expect(browser.session).toBe('');
    const rows = await lib.db.execute(lib.sql`SELECT id FROM users WHERE oidc_sub = 'sub-outsider'`);
    expect(rows.length).toBe(0);
  });

  it('rejects a callback with a wrong state and a replayed callback', async () => {
    const start = await routes.login.GET(request('/auth/login'), { params: {} });
    const authorize = new URL(start.headers.get('location')!);
    const stateCookie = cookieValue(start, '__Host-pcp_oidc')!;
    nextIdentity = { sub: 'sub-alice', name: 'alice', groups: ['trance-0/app-pcp'], nonce: authorize.searchParams.get('nonce')! };
    const wrong = await routes.callback.GET(request('/auth/callback?code=c&state=forged', { cookies: { '__Host-pcp_oidc': stateCookie } }), { params: {} });
    expect(wrong.headers.get('location')).toContain('auth_error=LOGIN_STATE_MISMATCH');
    // The login state is single use: even the right state now fails.
    const replay = await routes.callback.GET(
      request(`/auth/callback?code=c&state=${authorize.searchParams.get('state')}`, { cookies: { '__Host-pcp_oidc': stateCookie } }),
      { params: {} },
    );
    expect(replay.headers.get('location')).toContain('auth_error=LOGIN_STATE_MISSING');
    expect(cookieValue(replay, '__Host-pcp_session') || '').toBe('');
  });

  it('signs in app-pcp users and admin-pcp admins with secure cookies', async () => {
    const a = await signIn({ sub: 'sub-alice', name: 'alice', groups: ['trance-0/app-pcp'] });
    expect(a.callback.headers.get('location')).toBe(`${ORIGIN}/dashboard`);
    const setCookies = (a.callback.headers as Headers & { getSetCookie: () => string[] }).getSetCookie();
    const sessionCookie = setCookies.find((c) => c.startsWith('__Host-pcp_session='))!;
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/Secure/i);
    expect(sessionCookie).toMatch(/SameSite=lax/i);
    expect(sessionCookie).toMatch(/Path=\//i);
    alice = a.browser;
    bob = (await signIn({ sub: 'sub-bob', name: 'bob', groups: ['trance-0/app-pcp'] })).browser;
    admin = (await signIn({ sub: 'sub-admin', name: 'ncadmin', groups: ['trance-0/app-pcp', 'trance-0/admin-pcp'] })).browser;

    const me = await call('me', 'GET', '/api/v1/auth/me', { browser: alice });
    expect(me.body).toMatchObject({ display_name: 'alice', is_admin: false, method: 'oidc' });
    expect((await call('me', 'GET', '/api/v1/auth/me', { browser: admin })).body.is_admin).toBe(true);
  });

  it('regenerates the session on login (old session id stops working)', async () => {
    const first = (await signIn({ sub: 'sub-carol', name: 'carol', groups: ['trance-0/app-pcp'] })).browser;
    const second = (await signIn({ sub: 'sub-carol', name: 'carol', groups: ['trance-0/app-pcp'] }, first)).browser;
    expect(second.session).not.toBe(first.session);
    expect((await call('me', 'GET', '/api/v1/auth/me', { browser: first })).res.status).toBe(401);
    expect((await call('me', 'GET', '/api/v1/auth/me', { browser: second })).res.status).toBe(200);
  });

  it('state-changing requests need the CSRF header', async () => {
    const res = await call('sessions', 'POST', '/api/v1/sessions', { browser: alice, csrf: false, body: { title: 'x' } });
    expect(res.res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_REJECTED');
    const forged = await call('sessions', 'POST', '/api/v1/sessions', { browser: { ...alice, csrf: bob.csrf }, body: { title: 'x' } });
    expect(forged.res.status).toBe(403);
  });

  let aliceSession = '';
  let bobSession = '';
  let unownedSession = '';

  it('non-owners get 403 on another user\'s session; admins see all', async () => {
    aliceSession = (await call('sessions', 'POST', '/api/v1/sessions', { browser: alice, body: { title: 'alice notes' } })).body.id;
    bobSession = (await call('sessions', 'POST', '/api/v1/sessions', { browser: bob, body: { title: 'bob notes' } })).body.id;
    unownedSession = 'ses_unowned_1';
    await lib.db.execute(lib.sql`INSERT INTO sessions (id, title) VALUES (${unownedSession}, 'imported')`);

    expect((await call('session', 'GET', '', { browser: alice }, { id: aliceSession })).res.status).toBe(200);
    expect((await call('session', 'GET', '', { browser: bob }, { id: aliceSession })).res.status).toBe(403);
    expect((await call('session', 'PATCH', '', { browser: bob, body: { title: 'pwned' } }, { id: aliceSession })).res.status).toBe(403);
    expect((await call('tokens', 'POST', '', { browser: bob, body: {} }, { id: aliceSession })).res.status).toBe(403);
    expect((await call('session', 'GET', '', { browser: alice }, { id: unownedSession })).res.status).toBe(403);
    expect((await call('session', 'GET', '', { browser: admin }, { id: unownedSession })).res.status).toBe(200);
    expect((await call('session', 'GET', '', { browser: admin }, { id: bobSession })).res.status).toBe(200);

    const aliceList = (await call('sessions', 'GET', '/api/v1/sessions', { browser: alice })).body.sessions.map((s: { id: string }) => s.id);
    expect(aliceList).toEqual([aliceSession]);
    const adminList = (await call('sessions', 'GET', '/api/v1/sessions', { browser: admin })).body.sessions.map((s: { id: string }) => s.id);
    expect(adminList).toEqual(expect.arrayContaining([aliceSession, bobSession, unownedSession]));
  });

  it('admin-only operations are refused for regular users', async () => {
    expect((await call('topics', 'POST', '/api/v1/topics', { browser: alice, body: { title: 't' } })).res.status).toBe(403);
    expect((await call('topics', 'POST', '/api/v1/topics', { browser: admin, body: { title: 't' } })).res.status).toBe(200);
    expect((await call('session', 'DELETE', '', { browser: alice }, { id: aliceSession })).res.status).toBe(403);
    expect((await call('claims', 'POST', '', { browser: alice, body: { principal: 'telegram:1' } }, { id: aliceSession })).res.status).toBe(403);
    expect((await call('session', 'PATCH', '', { browser: alice, body: { principal: 'telegram:999' } }, { id: aliceSession })).res.status).toBe(403);
  });

  it('claim codes link the principal, are single-use, expire and reject wrong codes', async () => {
    const dm = 'ses_dm_1';
    await lib.db.execute(lib.sql`INSERT INTO sessions (id, title, principal, class) VALUES (${dm}, 'telegram dm', 'telegram:111', 'trusted')`);
    expect((await call('session', 'GET', '', { browser: alice }, { id: dm })).res.status).toBe(403);

    const issued = await call('claims', 'POST', '', { browser: admin, body: {} }, { id: dm });
    expect(issued.res.status).toBe(200);
    const code: string = issued.body.code;
    expect(issued.body.claim_url).toContain('/claim?code=');
    const stored = await lib.db.execute(lib.sql`SELECT code_hash FROM claims WHERE id = ${issued.body.claim_id}`);
    expect(JSON.stringify(stored)).not.toContain(code.replace(/-/g, ''));

    const wrong = await call('redeem', 'POST', '/api/v1/claims/redeem', { browser: alice, body: { code: 'AAAAA-AAAAA-AAAAA-AAAAA' } });
    expect(wrong.res.status).toBe(400);
    expect(wrong.body.code).toBe('CLAIM_INVALID');

    const noCsrf = await call('redeem', 'POST', '/api/v1/claims/redeem', { browser: alice, csrf: false, body: { code } });
    expect(noCsrf.res.status).toBe(403);

    const ok = await call('redeem', 'POST', '/api/v1/claims/redeem', { browser: alice, body: { code: code.toLowerCase() } });
    expect(ok.res.status).toBe(200);
    expect(ok.body).toMatchObject({ session_id: dm, principal: 'telegram:111' });
    expect((await call('session', 'GET', '', { browser: alice }, { id: dm })).res.status).toBe(200);
    expect((await call('session', 'GET', '', { browser: bob }, { id: dm })).res.status).toBe(403);

    const again = await call('redeem', 'POST', '/api/v1/claims/redeem', { browser: bob, body: { code } });
    expect(again.res.status).toBe(409);
    expect(again.body.code).toBe('CLAIM_ALREADY_REDEEMED');

    const expiredDm = 'ses_dm_expired';
    await lib.db.execute(lib.sql`INSERT INTO sessions (id, title, principal, class) VALUES (${expiredDm}, 'old dm', 'telegram:222', 'trusted')`);
    const expired = await lib.createClaim(expiredDm, 'telegram:222', new Date(Date.now() - 16 * 60 * 1000));
    expect(expired.ok).toBe(true);
    const late = await call('redeem', 'POST', '/api/v1/claims/redeem', { browser: bob, body: { code: expired.ok ? expired.code : '' } });
    expect(late.res.status).toBe(410);
    expect(late.body.code).toBe('CLAIM_EXPIRED');
    expect((await call('session', 'GET', '', { browser: bob }, { id: expiredDm })).res.status).toBe(403);
  });

  it('later sessions with a linked principal are owned automatically; group sessions stay admin-only', async () => {
    const later = 'ses_dm_later';
    await lib.db.execute(lib.sql`INSERT INTO sessions (id, title) VALUES (${later}, 'second telegram dm')`);
    const patched = await call('session', 'PATCH', '', { browser: admin, body: { principal: 'telegram:111', class: 'trusted' } }, { id: later });
    expect(patched.res.status).toBe(200);
    const owner = await lib.db.execute(lib.sql`SELECT owner_user_id FROM sessions WHERE id = ${later}`);
    const aliceRow = await lib.db.execute(lib.sql`SELECT id FROM users WHERE oidc_sub = 'sub-alice'`);
    expect(owner[0].owner_user_id).toBe(aliceRow[0].id);
    expect((await call('session', 'GET', '', { browser: alice }, { id: later })).res.status).toBe(200);

    const group = 'ses_group_1';
    await lib.db.execute(lib.sql`INSERT INTO sessions (id, title, principal, class) VALUES (${group}, 'group', 'telegram:111', 'group')`);
    expect((await call('session', 'GET', '', { browser: alice }, { id: group })).res.status).toBe(403);
    expect((await call('session', 'GET', '', { browser: admin }, { id: group })).res.status).toBe(200);
    expect((await call('claims', 'POST', '', { browser: admin, body: {} }, { id: group })).res.status).toBe(409);
    const list = (await call('sessions', 'GET', '/api/v1/sessions', { browser: alice })).body.sessions.map((s: { id: string }) => s.id);
    expect(list).not.toContain(group);
    expect(list).toEqual(expect.arrayContaining([aliceSession, 'ses_dm_1', later]));
  });

  it('a principal linked to one user cannot be claimed by another', async () => {
    const other = 'ses_dm_other';
    await lib.db.execute(lib.sql`INSERT INTO sessions (id, title, principal, class) VALUES (${other}, 'dm', 'telegram:111', 'trusted')`);
    const claim = await lib.createClaim(other, 'telegram:111');
    const res = await call('redeem', 'POST', '/api/v1/claims/redeem', { browser: bob, body: { code: claim.ok ? claim.code : '' } });
    expect(res.res.status).toBe(409);
    expect(res.body.code).toBe('PRINCIPAL_LINKED_ELSEWHERE');
  });

  it('rate-limits failed claim redemption', async () => {
    const carol = (await signIn({ sub: 'sub-dave', name: 'dave', groups: ['trance-0/app-pcp'] })).browser;
    for (let i = 0; i < 10; i += 1) {
      expect((await call('redeem', 'POST', '/api/v1/claims/redeem', { browser: carol, body: { code: 'nope' } })).res.status).toBe(400);
    }
    const limited = await call('redeem', 'POST', '/api/v1/claims/redeem', { browser: carol, body: { code: 'nope' } });
    expect(limited.res.status).toBe(429);
  });

  it('the existing agent recording-token flow still works and stays session-scoped', async () => {
    const minted = await call('tokens', 'POST', '', { browser: alice, body: { expires_in: '7d' } }, { id: aliceSession });
    expect(minted.res.status).toBe(200);
    const token: string = minted.body.token;

    const append = await call('agentMessages', 'POST', '', { bearer: token, body: { messages: [{ role: 'user', content: 'hello from an agent' }] } }, { id: aliceSession });
    expect(append.res.status).toBe(200);
    const wrongSession = await call('agentMessages', 'POST', '', { bearer: token, body: { messages: [{ role: 'user', content: 'x' }] } }, { id: bobSession });
    expect(wrongSession.res.status).toBe(403);
    const count = await lib.db.execute(lib.sql`SELECT count(*)::int AS n FROM messages WHERE session_id = ${aliceSession}`);
    expect(count[0].n).toBe(1);
    // Agent tokens are not web UI credentials.
    expect((await call('sessions', 'GET', '/api/v1/sessions', { bearer: token })).res.status).toBe(401);
  });

  it('logout revokes the server-side session', async () => {
    expect((await call('logout', 'POST', '/auth/logout', { browser: bob, csrf: false })).res.status).toBe(403);
    expect((await call('logout', 'POST', '/auth/logout', { browser: bob })).res.status).toBe(200);
    expect((await call('me', 'GET', '/api/v1/auth/me', { browser: bob })).res.status).toBe(401);
  });
});
