import { beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import postgres from 'postgres';
import { execFileSync } from 'node:child_process';

const base = process.env.PCP_TEST_DATABASE_URL || '';
const enabled = Boolean(base) && /test/i.test(new URL(base || 'postgres://x/none').pathname);
const url = new URL(base || 'postgres://x/none');
url.pathname += '_documents';
if (enabled) process.env.DATABASE_URL = url.toString();

describe.skipIf(!enabled)('session JSON file transfer (disposable database)', () => {
  let raw: ReturnType<typeof postgres>;
  let routes: typeof import('../src/app/api/v1/sessions/[id]/document/route');
  let alice: { sessionValue: string; csrfValue: string };
  let bob: typeof alice;
  const source = { sid: 'source', title: 'Portable session', summary: 'Context Summary Compact', messages: [
    { ordinal: 1, role: 'user', content: 'same' },
    { ordinal: 2, role: 'user', content: 'same' },
    { ordinal: 4, role: 'assistant', content: '  preserved\n' },
  ] };

  async function call(method: 'GET' | 'POST', id: string, body?: unknown, options: { browser?: typeof alice | null; csrf?: boolean; bearer?: string; rawBody?: string } = {}) {
    const browser = options.browser === undefined ? alice : options.browser;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (browser) {
      headers.cookie = `__Host-pcp_session=${browser.sessionValue}`;
      if (options.csrf !== false) headers['x-pcp-csrf'] = browser.csrfValue;
    }
    if (options.bearer) headers.authorization = `Bearer ${options.bearer}`;
    const request = new NextRequest(`https://pcp.example.test/api/v1/sessions/${id}/document`, {
      method, headers, ...(method === 'POST' ? { body: options.rawBody ?? JSON.stringify(body) } : {}),
    });
    const response = await routes[method](request, { params: { id } });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }

  beforeAll(async () => {
    delete process.env.PCP_BREAK_GLASS_ADMIN_LOGIN;
    const admin = postgres(base, { max: 1, onnotice: () => undefined });
    const name = url.pathname.slice(1).replace(/"/g, '');
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    await admin.end();
    execFileSync(process.execPath, ['scripts/deploy-init.js'], { env: { ...process.env, PCP_ADMIN_TOKEN: 'document-test-admin-token-32-characters' }, stdio: 'pipe' });
    raw = postgres(url.toString(), { max: 2, onnotice: () => undefined });
    await raw`INSERT INTO users (id, oidc_issuer, oidc_sub, display_name, is_admin) VALUES
      ('alice', 'https://idp.test', 'alice', 'Alice', false), ('bob', 'https://idp.test', 'bob', 'Bob', false)`;
    const { createWebSession } = await import('../src/lib/web-session');
    alice = await createWebSession('alice'); bob = await createWebSession('bob');
    for (const id of ['source', 'target', 'concurrent', 'locked', 'archived', 'large']) {
      await raw`INSERT INTO sessions (id, title, owner_user_id, class, mode, archived) VALUES
        (${id}, ${id === 'source' ? source.title : 'Existing title'}, 'alice', 'trusted', ${id === 'locked' ? 'locked' : 'wild'}, ${id === 'archived'})`;
    }
    await raw`UPDATE sessions SET context_title = 'Context', context_summary = 'Summary' WHERE id = 'source'`;
    await raw`INSERT INTO compactions (id, session_id, summary) VALUES ('compact', 'source', 'Compact')`;
    for (const message of source.messages) await raw`INSERT INTO messages (id, session_id, ordinal, role, content, observed_at)
      VALUES (${`source-${message.ordinal}`}, 'source', ${message.ordinal}, ${message.role}, ${message.content}, now())`;
    await raw`INSERT INTO messages (id, session_id, ordinal, role, content, observed_at)
      SELECT 'large-' || n, 'large', n, 'user', 'message ' || n, now() FROM generate_series(1, 601) n`;
    routes = await import('../src/app/api/v1/sessions/[id]/document/route');
  });

  it('exports the full server content as a plain JSON download, including all pages', async () => {
    const exported = await call('GET', 'source');
    expect(exported.status).toBe(200); expect(exported.body).toEqual(source);
    expect(exported.headers.get('content-disposition')).toContain('attachment; filename="pcp-session-source.json"');
    expect(exported.headers.get('cache-control')).toBe('private, no-store');
    expect((await call('GET', 'large')).body.messages).toHaveLength(601);
  });

  it('imports into the selected destination, preserves repeated turns, and replays without duplication', async () => {
    const imported = await call('POST', 'target', { _source: { ...source, ready: true, fingerprint: 'ignored', passages: [] } });
    expect(imported.status).toBe(200);
    expect(imported.body).toMatchObject({ imported: 3, skipped: 0, metadata_initialized: true });
    const roundTrip = await call('GET', 'target');
    expect(roundTrip.body).toEqual({ ...source, sid: 'target', messages: source.messages.map((m, i) => ({ ...m, ordinal: i + 1 })) });
    expect((await call('POST', 'target', source)).body).toMatchObject({ imported: 0, skipped: 3, metadata_initialized: false });
    expect((await call('POST', 'source', source)).body).toMatchObject({ imported: 0, skipped: 3 });
    expect((await call('GET', 'source')).body).toEqual(source);
  });

  it('serializes concurrent uploads and audits the document import', async () => {
    const results = await Promise.all([call('POST', 'concurrent', source), call('POST', 'concurrent', source)]);
    expect(results.map(r => r.body.imported).sort()).toEqual([0, 3]);
    const rows = await raw`SELECT details_json FROM events WHERE session_id = 'concurrent' AND action = 'session.document_imported'`;
    expect(rows).toHaveLength(2);
  });

  it('merges a large document without the old paste limit or overwriting existing context', async () => {
    const file = (await call('GET', 'large')).body;
    const imported = await call('POST', 'target', file);
    expect(imported.body).toMatchObject({ imported: 601, metadata_initialized: false });
    const result = (await call('GET', 'target')).body;
    expect(result.messages).toHaveLength(604);
    expect(result.title).toBe(source.title); expect(result.summary).toBe(source.summary);
  });

  it('requires browser ownership and CSRF, and never accepts agent credentials', async () => {
    expect((await call('GET', 'source', undefined, { browser: null })).status).toBe(401);
    expect((await call('GET', 'source', undefined, { browser: bob })).status).toBe(403);
    expect((await call('POST', 'target', source, { browser: bob })).status).toBe(403);
    expect((await call('POST', 'target', source, { csrf: false })).status).toBe(403);
    expect((await call('GET', 'source', undefined, { browser: null, bearer: 'fake-agent-token' })).status).toBe(401);
    expect((await call('GET', 'missing')).status).toBe(404);
  });

  it('rejects invalid, oversized and read-only imports without partial writes', async () => {
    expect((await call('POST', 'target', undefined, { rawBody: '{' })).status).toBe(400);
    expect((await call('POST', 'target', { ...source, messages: [...source.messages, source.messages[0]] })).status).toBe(422);
    expect((await call('POST', 'target', undefined, { rawBody: 'x'.repeat(20 * 1024 * 1024 + 1) })).status).toBe(413);
    for (const id of ['locked', 'archived']) {
      expect((await call('POST', id, source)).status).toBe(409);
      expect((await call('GET', id)).body.messages).toEqual([]);
    }
    expect((await call('GET', 'target')).body.messages).toHaveLength(604);
  });
});
