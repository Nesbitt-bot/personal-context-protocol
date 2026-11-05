/**
 * Service credentials, turn grants, sync and recall against real PostgreSQL.
 *
 * Skipped unless PCP_TEST_DATABASE_URL points at a disposable database whose
 * name contains "test". This file uses its own `<name>_service` database
 * (created on the same server; needs CREATEDB) so it can run in parallel with
 * tests/identity-db.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import postgres from 'postgres';

const BASE_DB = process.env.PCP_TEST_DATABASE_URL || '';
const enabled = Boolean(BASE_DB) && /test/i.test(new URL(BASE_DB || 'postgres://x/none').pathname);
const SERVICE_DB = (() => {
  if (!enabled) return '';
  const url = new URL(BASE_DB);
  url.pathname = `${url.pathname}_service`;
  return url.toString();
})();
if (enabled) process.env.DATABASE_URL = SERVICE_DB;

const ORIGIN = 'https://pcp.example.test';
type Handler = (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<Response>;

describe.skipIf(!enabled)('service credentials, turn grants, sync and recall (database)', () => {
  let routes: Record<string, Record<string, Handler>>;
  let lib: {
    db: typeof import('../src/lib/db')['db'];
    sql: typeof import('drizzle-orm')['sql'];
    createServiceCredential: typeof import('../src/lib/service-auth')['createServiceCredential'];
    createWebSession: typeof import('../src/lib/web-session')['createWebSession'];
  };
  let openclaw = '';
  let astrbot = '';
  let other = '';
  let adminBrowser = { session: '', csrf: '' };
  let aliceBrowser = { session: '', csrf: '' };

  function request(url: string, opts: { method?: string; bearer?: string; body?: unknown; browser?: { session: string; csrf: string } } = {}) {
    const headers: Record<string, string> = {};
    if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
    if (opts.browser) {
      headers.cookie = `__Host-pcp_session=${opts.browser.session}`;
      headers['x-pcp-csrf'] = opts.browser.csrf;
    }
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    return new NextRequest(new URL(url, ORIGIN), { method: opts.method || 'POST', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  }

  async function call(route: string, method: string, opts: Parameters<typeof request>[1] = {}, params: Record<string, string> = {}) {
    const res = await routes[route][method](request('/x', { ...opts, method }), { params });
    return { status: res.status, body: await res.json() };
  }

  const grant = (bearer: string, body: Record<string, unknown>) => call('grants', 'POST', { bearer, body });

  beforeAll(async () => {
    delete process.env.PCP_BREAK_GLASS_ADMIN_LOGIN;
    const admin = postgres(BASE_DB, { max: 1, onnotice: () => undefined });
    const name = new URL(SERVICE_DB).pathname.slice(1);
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
    await admin.end();

    const { db } = await import('../src/lib/db');
    const { sql } = await import('drizzle-orm');
    const { ensureDatabaseSchema } = await import('../src/lib/setup-schema');
    const { createServiceCredential } = await import('../src/lib/service-auth');
    const { createWebSession } = await import('../src/lib/web-session');
    lib = { db, sql, createServiceCredential, createWebSession };
    await ensureDatabaseSchema();
    await db.execute(sql.raw(`TRUNCATE synced_turns, turn_grants, service_credentials, claim_attempts, claims, identities,
      web_sessions, oidc_login_states, session_links, scoped_tokens, session_tokens, messages, compactions, events, sessions, topics, users CASCADE`));

    await db.execute(sql`INSERT INTO users (id, oidc_issuer, oidc_sub, display_name, is_admin) VALUES
      ('usr_alice', 'https://idp.test', 'alice', 'alice', false),
      ('usr_bob', 'https://idp.test', 'bob', 'bob', false),
      ('usr_admin', 'https://idp.test', 'admin', 'admin', true)`);
    await db.execute(sql`INSERT INTO identities (principal, user_id, link_method) VALUES
      ('telegram:111', 'usr_alice', 'admin'), ('openclaw-weixin:aaa', 'usr_alice', 'admin'), ('telegram:222', 'usr_bob', 'admin')`);
    await db.execute(sql`INSERT INTO sessions (id, title, owner_user_id, class) VALUES
      ('ses_alice_notes', 'alice notes', 'usr_alice', 'trusted'),
      ('ses_bob_notes', 'bob notes', 'usr_bob', 'trusted'),
      ('ses_unowned', 'imported', NULL, 'unattributed')`);
    await db.execute(sql`INSERT INTO messages (id, session_id, ordinal, role, content, observed_at) VALUES
      ('msg_b1', 'ses_bob_notes', 1, 'user', 'bob secret plan', now()),
      ('msg_a1', 'ses_alice_notes', 1, 'user', 'alice remembers the blue door', now())`);

    const created = await createWebSession('usr_admin');
    adminBrowser = { session: created.sessionValue, csrf: created.csrfValue };
    const createdAlice = await createWebSession('usr_alice');
    aliceBrowser = { session: createdAlice.sessionValue, csrf: createdAlice.csrfValue };
    astrbot = (await createServiceCredential('astrbot ingress', ['astrbot:'], null, { kind: 'ingress' })).token;
    other = (await createServiceCredential('other channel', ['discord:'], null)).token;

    routes = {
      creds: await import('../src/app/api/v1/service-credentials/route'),
      grants: await import('../src/app/api/v1/service/grants/route'),
      sync: await import('../src/app/api/v1/service/sync/route'),
      recall: await import('../src/app/api/v1/service/recall/route'),
      search: await import('../src/app/api/v1/service/search/route'),
      sessions: await import('../src/app/api/v1/sessions/route'),
      agentMessages: await import('../src/app/api/v1/agent/sessions/[id]/messages/route'),
    } as unknown as Record<string, Record<string, Handler>>;
  });

  afterAll(async () => {
    // Leave the database for inspection; it is truncated on the next run.
  });

  it('only admins can mint service credentials; the token is shown once', async () => {
    expect((await call('creds', 'POST', { body: { name: 'x', principal_prefixes: ['telegram:'] } })).status).toBe(401);
    expect((await call('creds', 'POST', { browser: aliceBrowser, body: { name: 'x', principal_prefixes: ['telegram:'] } })).status).toBe(403);
    expect((await call('creds', 'POST', { browser: adminBrowser, body: { name: 'x', principal_prefixes: ['tele'] } })).status).toBe(400);
    const minted = await call('creds', 'POST', { browser: adminBrowser, body: { name: 'openclaw-pcp', principal_prefixes: ['telegram:', 'openclaw-weixin:'] } });
    expect(minted.status).toBe(200);
    openclaw = minted.body.token;
    expect(openclaw).toMatch(/^pcps_[0-9a-f]{64}$/);
    const list = await call('creds', 'GET', { browser: adminBrowser });
    expect(JSON.stringify(list.body)).not.toContain(openclaw);
    expect(JSON.stringify(list.body)).not.toContain('token_hash');
  });

  it('service routes need a valid service credential, and service credentials are nothing else', async () => {
    expect((await grant('', { session_key: 'k', principal: 'telegram:111', chat: 'direct' })).status).toBe(401);
    expect((await grant('pcps_' + '0'.repeat(64), { session_key: 'k', principal: 'telegram:111', chat: 'direct' })).status).toBe(401);
    // Not a web UI login (admin) ...
    expect((await call('sessions', 'GET', { bearer: openclaw })).status).toBe(401);
    // ... and not an agent recording token.
    expect((await call('agentMessages', 'POST', { bearer: openclaw, body: { messages: [{ role: 'user', content: 'x' }] } }, { id: 'ses_alice_notes' })).status).toBe(401);
  });

  it('a credential may only assert principals of its own platforms', async () => {
    const res = await grant(openclaw, { session_key: 'agent:main:qq', principal: 'astrbot:qq:1', chat: 'direct' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PRINCIPAL_NOT_ALLOWED');
    expect((await grant(other, { session_key: 'k', principal: 'telegram:111', chat: 'direct' })).status).toBe(403);
    expect((await grant(openclaw, { session_key: 'k', principal: 'telegram:group:-100', chat: 'direct' })).status).toBe(400);
    // The AstrBot ingress credential is not a channel credential: /service/* refuses it outright.
    expect((await grant(astrbot, { session_key: 'k', principal: 'astrbot:qq:1', chat: 'direct' })).status).toBe(401);
    // astrbot: is reserved for the ingress kind: the admin API will not mint it as a channel prefix.
    expect((await call('creds', 'POST', { browser: adminBrowser, body: { name: 'fake astrbot', principal_prefixes: ['astrbot:'] } })).status).toBe(400);
  });

  it('a linked DM principal reads the owner\'s sessions across channels, never other users\' or group sessions', async () => {
    const tg = await grant(openclaw, { session_key: 'agent:main:telegram:111', principal: 'telegram:111', chat: 'direct' });
    expect(tg.status).toBe(200);
    expect(tg.body.linked).toBe(true);
    expect(tg.body.claim).toBeNull();
    const tgHome = tg.body.session_id as string;
    const owner = await lib.db.execute(lib.sql`SELECT owner_user_id, class, principal FROM sessions WHERE id = ${tgHome}`);
    expect(owner[0]).toMatchObject({ owner_user_id: 'usr_alice', class: 'trusted', principal: 'telegram:111' });
    expect(tg.body.readable_session_ids).toEqual(expect.arrayContaining([tgHome, 'ses_alice_notes']));
    expect(tg.body.readable_session_ids).not.toContain('ses_bob_notes');
    expect(tg.body.readable_session_ids).not.toContain('ses_unowned');

    const synced = await call('sync', 'POST', { bearer: openclaw, body: {
      session_key: 'agent:main:telegram:111', external_key: 'tg-turn-1',
      messages: [{ role: 'user', content: 'the launch codename is HERON' }, { role: 'assistant', content: 'noted' }],
    } });
    expect(synced.status).toBe(200);
    expect(synced.body).toMatchObject({ duplicate: false, session_id: tgHome, first_ordinal: 1, message_count: 2 });

    // OpenClaw-WeChat DM of the same person recalls the Telegram topic.
    const wx = await grant(openclaw, { session_key: 'agent:main:weixin:aaa', principal: 'openclaw-weixin:aaa', chat: 'direct' });
    expect(wx.body.readable_session_ids).toContain(tgHome);
    const recalled = await call('recall', 'POST', { bearer: openclaw, body: { session_key: 'agent:main:weixin:aaa' } });
    expect(recalled.status).toBe(200);
    expect(JSON.stringify(recalled.body.messages)).toContain('HERON');
    expect(JSON.stringify(recalled.body.messages)).not.toContain('bob secret plan');
    const found = await call('search', 'POST', { bearer: openclaw, body: { session_key: 'agent:main:weixin:aaa', query: 'heron' } });
    expect(found.body.results.map((r: { session_id: string }) => r.session_id)).toEqual([tgHome]);
    expect((await call('search', 'POST', { bearer: openclaw, body: { session_key: 'agent:main:weixin:aaa', query: 'secret plan' } })).body.results).toEqual([]);
  });

  it('sync is idempotent by external key', async () => {
    const body = { session_key: 'agent:main:telegram:111', external_key: 'tg-turn-1', messages: [{ role: 'user', content: 'the launch codename is HERON' }] };
    const again = await call('sync', 'POST', { bearer: openclaw, body });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, first_ordinal: 1, message_count: 2 });
    const count = await lib.db.execute(lib.sql`SELECT count(*)::int AS n FROM messages WHERE content LIKE '%HERON%'`);
    expect(count[0].n).toBe(1);
  });

  it('a group turn reads only the group\'s own session', async () => {
    const g = await grant(openclaw, { session_key: 'agent:relay:telegram:group:-100', principal: 'telegram:111', chat: 'group', group_id: '-100' });
    expect(g.status).toBe(200);
    expect(g.body.readable_session_ids).toEqual([g.body.session_id]);
    expect(g.body.claim).toBeNull();
    const cls = await lib.db.execute(lib.sql`SELECT class, principal, owner_user_id FROM sessions WHERE id = ${g.body.session_id}`);
    expect(cls[0]).toMatchObject({ class: 'group', principal: 'telegram:group:-100', owner_user_id: null });

    const recallDm = await call('recall', 'POST', { bearer: openclaw, body: { session_key: 'agent:relay:telegram:group:-100', session_id: 'ses_alice_notes' } });
    expect(recallDm.status).toBe(403);
    expect((await call('search', 'POST', { bearer: openclaw, body: { session_key: 'agent:relay:telegram:group:-100', query: 'HERON' } })).body.results).toEqual([]);
    // Alice (non-admin) cannot see the group session in the web UI either.
    const aliceList = await call('sessions', 'GET', { browser: aliceBrowser });
    expect(aliceList.body.sessions.map((s: { id: string }) => s.id)).not.toContain(g.body.session_id);
  });

  it('an unlinked DM reads only its own session and can get a claim code', async () => {
    const u = await grant(openclaw, { session_key: 'agent:main:telegram:999', principal: 'telegram:999', chat: 'direct', issue_claim: true });
    expect(u.status).toBe(200);
    expect(u.body.linked).toBe(false);
    expect(u.body.readable_session_ids).toEqual([u.body.session_id]);
    expect(u.body.claim.code).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/);
    expect(u.body.claim.claim_url).toContain('/claim?code=');
  });

  it('grants are bound to the credential and expire', async () => {
    // Another credential cannot use OpenClaw's grant.
    expect((await call('recall', 'POST', { bearer: other, body: { session_key: 'agent:main:telegram:111' } })).status).toBe(403);
    expect((await call('recall', 'POST', { bearer: astrbot, body: { session_key: 'agent:main:telegram:111' } })).status).toBe(401);

    await lib.db.execute(lib.sql`UPDATE turn_grants SET expires_at = now() - interval '1 second' WHERE session_key = 'agent:main:telegram:111'`);
    const expired = await call('recall', 'POST', { bearer: openclaw, body: { session_key: 'agent:main:telegram:111' } });
    expect(expired.status).toBe(403);
    expect(expired.body.code).toBe('GRANT_REQUIRED');
    expect((await call('sync', 'POST', { bearer: openclaw, body: { session_key: 'agent:main:telegram:111', external_key: 'late', messages: [{ role: 'user', content: 'x' }] } })).status).toBe(403);
  });

  it('a new grant replaces the previous one and grants can be ended', async () => {
    await grant(openclaw, { session_key: 'agent:main:weixin:aaa', principal: 'openclaw-weixin:aaa', chat: 'direct' });
    const live = await lib.db.execute(lib.sql`SELECT count(*)::int AS n FROM turn_grants WHERE session_key = 'agent:main:weixin:aaa' AND revoked_at IS NULL`);
    expect(live[0].n).toBe(1);
    expect((await call('grants', 'DELETE', { bearer: openclaw, body: { session_key: 'agent:main:weixin:aaa' } })).body.ended).toBe(1);
    expect((await call('recall', 'POST', { bearer: openclaw, body: { session_key: 'agent:main:weixin:aaa' } })).status).toBe(403);
  });

  it('a revoked credential stops working immediately', async () => {
    const list = await call('creds', 'GET', { browser: adminBrowser });
    const id = list.body.credentials.find((c: { name: string }) => c.name === 'openclaw-pcp').id;
    expect((await call('creds', 'DELETE', { browser: adminBrowser, body: { id } })).status).toBe(200);
    expect((await grant(openclaw, { session_key: 'k2', principal: 'telegram:111', chat: 'direct' })).status).toBe(401);
  });
});
