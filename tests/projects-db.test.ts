/**
 * Projects, workspaces, the sync conflict policy, merge tasks and their
 * authorization against real PostgreSQL, starting from a v0.2.1 database.
 *
 * Skipped unless PCP_TEST_DATABASE_URL points at a disposable database whose
 * name contains "test". Uses its own `<name>_projects` database (needs
 * CREATEDB), dropped and recreated each run so the upgrade path is real.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import postgres from 'postgres';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';

const BASE_DB = process.env.PCP_TEST_DATABASE_URL || '';
const enabled = Boolean(BASE_DB) && /test/i.test(new URL(BASE_DB || 'postgres://x/none').pathname);
const PROJECT_DB = (() => {
  if (!enabled) return '';
  const url = new URL(BASE_DB);
  url.pathname = `${url.pathname}_projects`;
  return url.toString();
})();
if (enabled) process.env.DATABASE_URL = PROJECT_DB;

const ORIGIN = 'https://pcp.example.test';
type Handler = (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<Response>;

describe.skipIf(!enabled)('projects, workspaces and sync conflicts (database, upgrade from 0.2.1)', () => {
  let routes: Record<string, Record<string, Handler>>;
  let raw: ReturnType<typeof postgres>;
  const tokens: Record<string, string> = {};
  let adminBrowser = { session: '', csrf: '' };
  let aliceBrowser = { session: '', csrf: '' };
  const before: Record<string, number> = {};

  function request(url: string, opts: { method?: string; bearer?: string; body?: unknown; browser?: { session: string; csrf: string } } = {}) {
    const headers: Record<string, string> = {};
    if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
    if (opts.browser) {
      headers.cookie = `__Host-pcp_session=${opts.browser.session}`;
      headers['x-pcp-csrf'] = opts.browser.csrf;
    }
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    return new NextRequest(new URL(url, ORIGIN), { method: opts.method || 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  }

  async function call(route: string, method: string, opts: Parameters<typeof request>[1] & { query?: string } = {}, params: Record<string, string> = {}) {
    const res = await routes[route][method](request(`/x${opts.query || ''}`, { ...opts, method }), { params });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  }

  async function mintScoped(id: string, scope: string, permissions: Record<string, boolean>, folderId: string | null = null) {
    const { generateToken, generateSalt, hashToken } = await import('../src/lib/auth');
    const token = generateToken();
    const salt = generateSalt();
    await raw`INSERT INTO scoped_tokens (id, token_hash, salt, token_prefix, name, scope, folder_id, permissions_json)
      VALUES (${id}, ${await hashToken(token, salt)}, ${salt}, ${token.substring(0, 16)}, ${id}, ${scope}, ${folderId}, ${raw.json(permissions)})`;
    return token;
  }

  beforeAll(async () => {
    delete process.env.PCP_BREAK_GLASS_ADMIN_LOGIN;
    const admin = postgres(BASE_DB, { max: 1, onnotice: () => undefined });
    const name = new URL(PROJECT_DB).pathname.slice(1).replace(/"/g, '');
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    await admin.end();
    raw = postgres(PROJECT_DB, { max: 2, onnotice: () => undefined });

    // A v0.2.1 database: the schema before migration 013, with imported data.
    const { SCHEMA_STATEMENTS, PROJECT_SCHEMA_STATEMENTS } = await import('../src/lib/setup-schema');
    for (const statement of SCHEMA_STATEMENTS.slice(0, SCHEMA_STATEMENTS.indexOf(PROJECT_SCHEMA_STATEMENTS[0]))) await raw.unsafe(statement);
    await raw`INSERT INTO users (id, oidc_issuer, oidc_sub, display_name, is_admin) VALUES
      ('usr_alice', 'https://idp.test', 'alice', 'alice', false), ('usr_admin', 'https://idp.test', 'admin', 'admin', true)`;
    await raw`INSERT INTO topics (id, title) VALUES ('top_a', 'A folder')`;
    await raw`INSERT INTO sessions (id, title, external_key, owner_user_id, class, last_message_at) VALUES
      ('ses_win_codex', 'opencode:win-384de1b4:circtime [codex] deploy page', 'win-384de1b4:codex:019f', NULL, 'unattributed', now()),
      ('ses_win_dsh', 'opencode:win-384de1b4:circtime [dsh] fix config', 'win-384de1b4:dsh:abc', NULL, 'unattributed', now()),
      ('ses_alice', 'alice owns this', 'linux-1048b0a6:claude:xyz', 'usr_alice', 'trusted', now())`;
    await raw`INSERT INTO messages (id, session_id, ordinal, role, content, observed_at) VALUES
      ('msg_1', 'ses_win_codex', 1, 'user', 'deploy via actions', now()),
      ('msg_2', 'ses_win_codex', 2, 'assistant', 'done', now()),
      ('msg_3', 'ses_alice', 1, 'user', 'alice task', now())`;
    for (const table of ['sessions', 'messages', 'topics', 'users']) before[table] = Number((await raw.unsafe(`SELECT count(*)::int AS n FROM ${table}`))[0].n);
    tokens.legacy = await mintScoped('stk_legacy', 'global', { read_all: true, mint_tokens: true, create_sessions: true, create_folders: false, delete_folders: false, delete_sessions: false, rename_sessions: false });

    // Upgrade with the deploy-time initializer, twice (idempotent), then the runtime path.
    for (let i = 0; i < 2; i += 1) {
      execFileSync('node', [path.join(__dirname, '../scripts/deploy-init.js')], { env: { ...process.env, DATABASE_URL: PROJECT_DB, PCP_ADMIN_TOKEN: 'x'.repeat(40) }, stdio: 'pipe' });
    }
    const { ensureDatabaseSchema } = await import('../src/lib/setup-schema');
    await ensureDatabaseSchema();

    tokens.manager = await mintScoped('stk_manager', 'global', { read_all: true, manage_projects: true });
    tokens.reader = await mintScoped('stk_reader', 'global', { read_all: true, manage_projects: false, create_sessions: false });
    tokens.folder = await mintScoped('stk_folder', 'folder', { read_all: true, manage_projects: true }, 'top_a');
    const { createWebSession } = await import('../src/lib/web-session');
    const a = await createWebSession('usr_admin');
    adminBrowser = { session: a.sessionValue, csrf: a.csrfValue };
    const b = await createWebSession('usr_alice');
    aliceBrowser = { session: b.sessionValue, csrf: b.csrfValue };

    routes = {
      search: await import('../src/app/api/v1/search/route'),
      scopedTokens: await import('../src/app/api/v1/tokens/route'),
      mProjects: await import('../src/app/api/v1/manager/projects/route'),
      mResolve: await import('../src/app/api/v1/manager/projects/resolve/route'),
      mWorkspaces: await import('../src/app/api/v1/manager/projects/[id]/workspaces/route'),
      presence: await import('../src/app/api/v1/presence/route'),
      beat: await import('../src/app/api/v1/manager/sessions/by-key/[key]/presence/route'),
      mContext: await import('../src/app/api/v1/manager/sessions/by-key/[key]/context/route'),
      mMerge: await import('../src/app/api/v1/manager/sessions/by-key/[key]/merge-messages/route'),
      mTasks: await import('../src/app/api/v1/manager/merge-tasks/route'),
      mComplete: await import('../src/app/api/v1/manager/merge-tasks/[id]/complete/route'),
      projects: await import('../src/app/api/v1/projects/route'),
      project: await import('../src/app/api/v1/projects/[id]/route'),
      sessionContext: await import('../src/app/api/v1/sessions/[id]/context/route'),
      conflicts: await import('../src/app/api/v1/conflicts/route'),
      conflict: await import('../src/app/api/v1/conflicts/[id]/route'),
      mergeRequest: await import('../src/app/api/v1/conflicts/[id]/merge-request/route'),
      byKey: await import('../src/app/api/v1/manager/sessions/by-key/[key]/route'),
    } as unknown as Record<string, Record<string, Handler>>;
  });

  it('upgrades a 0.2.1 database without losing or changing data, and records 013 once', async () => {
    for (const [table, n] of Object.entries(before)) {
      expect(Number((await raw.unsafe(`SELECT count(*)::int AS n FROM ${table}`))[0].n)).toBe(n);
    }
    const [s] = await raw`SELECT project_id, context_title, sync_clock_json, title FROM sessions WHERE id = 'ses_win_codex'`;
    expect(s).toMatchObject({ project_id: null, context_title: null, sync_clock_json: {}, title: 'opencode:win-384de1b4:circtime [codex] deploy page' });
    const [m] = await raw`SELECT content, external_message_id FROM messages WHERE id = 'msg_1'`;
    expect(m).toEqual({ content: 'deploy via actions', external_message_id: null });
    const versions = await raw`SELECT version FROM schema_migrations WHERE version = '013_projects'`;
    expect(versions.length).toBe(1);
    // The pre-0.2.2 import token keeps working for what it could do before.
    expect((await call('byKey', 'GET', { bearer: tokens.legacy }, { key: encodeURIComponent('win-384de1b4:codex:019f') })).body).toMatchObject({ found: true, message_count: 2 });
  });

  it('fences replaced workers, enforces visibility, expires missed beats and neutralizes a clean stop', async () => {
    const key = 'win-384de1b4:codex:019f';
    const run = '12345678-1234-4234-8234-123456789012';
    const second = '12345678-1234-4234-8234-123456789013';
    const beat = (bearer: string, start: boolean, state: string, id = run) => call('beat','POST',
      {bearer,body:{reporter:'codex',run:id,start,state}},{key});
    // This route returns 204 without a response body on success.
    expect((await beat(tokens.reader,true,'synced')).status).toBe(403);
    expect((await beat(tokens.legacy,true,'synced')).status).toBe(204);
    expect((await call('presence','GET',{browser:adminBrowser})).body.sessions.ses_win_codex).toBe('live');
    expect((await call('presence','GET',{browser:aliceBrowser})).body).toEqual({sessions:{},tasks:{}});
    await raw`UPDATE session_presence SET seen_at=now()-interval '70 seconds' WHERE session_id='ses_win_codex'`;
    expect((await call('presence','GET',{browser:adminBrowser})).body.sessions.ses_win_codex).toBe('problem');
    expect((await beat(tokens.legacy,true,'unsynced',second)).status).toBe(204);
    expect((await beat(tokens.legacy,false,'closed')).status).toBe(409);
    expect((await beat(tokens.legacy,false,'synced',second)).status).toBe(204);
    expect((await beat(tokens.legacy,false,'closed',second)).status).toBe(204);
    expect((await beat(tokens.legacy,false,'synced',second)).status).toBe(409);
    expect((await call('presence','GET',{browser:adminBrowser})).body.sessions.ses_win_codex).toBeUndefined();
  });

  it('operator `sessions export` reads identities in a read-only transaction, without content', async () => {
    const cli = createRequire(import.meta.url)('../scripts/pcp-operator.js');
    const exported = await cli.exportSessions(raw);
    expect(exported.has_projects).toBe(true);
    // Latest applied migration (schema_migrations versions sort lexically).
    expect(exported.schema_version).toBe('024_user_picture');
    expect(exported.sessions.find((x: { id: string }) => x.id === 'ses_win_codex')).toEqual({ id: 'ses_win_codex', external_key: 'win-384de1b4:codex:019f', title: 'opencode:win-384de1b4:circtime [codex] deploy page', project_id: null, archived: false });
    expect(JSON.stringify(exported)).not.toContain('deploy via actions');
    // The transaction really is read-only.
    await expect(raw.begin('read only', (tx) => tx`UPDATE sessions SET title = 'x' WHERE id = 'ses_win_codex'`)).rejects.toThrow(/read-only/);
  });

  it('gates project APIs on a global scoped token; writes need manage_projects; nothing else is accepted', async () => {
    const body = { git_remotes: ['git@github.com:Trance-0/circtime.git'] };
    expect((await call('mProjects', 'POST', { body })).status).toBe(401);
    expect((await call('mProjects', 'POST', { bearer: 'f'.repeat(64), body })).status).toBe(401);
    expect((await call('mProjects', 'POST', { bearer: tokens.legacy, body })).status).toBe(403);
    expect((await call('mProjects', 'POST', { bearer: tokens.reader, body })).status).toBe(403);
    expect((await call('mProjects', 'POST', { bearer: tokens.folder, body })).status).toBe(403);
    // A web admin session is not an agent credential.
    expect((await call('mProjects', 'POST', { browser: adminBrowser, body })).status).toBe(401);
    // Reads are fine with read_all.
    expect((await call('mProjects', 'GET', { bearer: tokens.reader })).status).toBe(200);
    // The web UI never accepts a scoped token.
    expect((await call('projects', 'GET', { bearer: tokens.manager })).status).toBe(401);
  });

  let projectId = '';

  it('retains the UI project permission when creating, verifying and revoking a scoped token', async () => {
    const created = await call('scopedTokens', 'POST', { browser: adminBrowser, body: {
      name: 'UI session sync', scope: 'global', expires_in: '1h',
      permissions: { read_all: true, create_sessions: true, mint_tokens: true, manage_projects: true },
    } });
    expect(created.status).toBe(200);
    expect(created.body.permissions.manage_projects).toBe(true);
    const token = created.body.access_token;
    const [stored] = await raw`SELECT token_hash, salt, permissions_json FROM scoped_tokens WHERE id = ${created.body.id}`;
    const { verifyToken } = await import('../src/lib/auth');
    expect(stored.token_hash).not.toBe(token);
    expect(await verifyToken(token, stored.token_hash, stored.salt)).toBe(true);
    expect(stored.permissions_json.manage_projects).toBe(true);
    const project = await call('mProjects', 'POST', { bearer: token, body: {
      canonical_key: 'name:ui-token-regression', display_name: 'UI token regression',
    } });
    expect(project.status).toBe(201);
    const revoked = await call('scopedTokens', 'PATCH', { browser: adminBrowser, body: {
      token_id: created.body.id, revoke: true,
    } });
    expect(revoked.status).toBe(200);
    expect((await call('mProjects', 'GET', { bearer: token })).status).toBe(401);
  });

  it('creates one project per canonical identity, idempotently, and merges remotes and aliases', async () => {
    const created = await call('mProjects', 'POST', { bearer: tokens.manager, body: {
      git_remotes: ['git@github.com:Trance-0/circtime.git'], display_name: 'circtime', aliases: ['name:circtime'],
      workspace: { device_id: 'win-384de1b4', device_kind: 'windows', directory: 'D:\\Documents\\Github\\circtime\\', default_branch: 'main', seen_at: '2026-10-01T10:00:00Z' },
    } });
    expect(created.status).toBe(201);
    projectId = created.body.project.id;
    expect(created.body.project).toMatchObject({ canonical_key: 'git:github.com/trance-0/circtime', git_remotes: ['github.com/Trance-0/circtime'] });
    expect(created.body.workspace).toMatchObject({ directory: 'D:/Documents/Github/circtime', created: true });

    // Same repo seen from Linux through the https form: same project, no duplicate.
    const again = await call('mProjects', 'POST', { bearer: tokens.manager, body: { git_remotes: ['https://github.com/Trance-0/circtime'], display_name: 'circtime' } });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: false, remotes_added: [], aliases_added: [] });
    expect(again.body.project.id).toBe(projectId);

    // A name-only identity resolves through the explicit alias.
    const byAlias = await call('mProjects', 'POST', { bearer: tokens.manager, body: { canonical_key: 'name:circtime' } });
    expect(byAlias.body.project.id).toBe(projectId);

    // A second remote (a mirror) is added, never replacing the first.
    const mirror = await call('mProjects', 'POST', { bearer: tokens.manager, body: { canonical_key: 'git:github.com/trance-0/circtime', git_remotes: ['git@git.trance-0.com:Trance-0/circtime.git'] } });
    expect(mirror.body.remotes_added).toEqual(['git.trance-0.com/Trance-0/circtime']);
    expect(mirror.body.project.git_remotes).toEqual(['github.com/Trance-0/circtime', 'git.trance-0.com/Trance-0/circtime']);

    // An alias already owned by another project is reported, not stolen.
    const other = await call('mProjects', 'POST', { bearer: tokens.manager, body: { display_name: 'cashflow', aliases: ['name:circtime'] } });
    expect(other.body.project.canonical_key).toBe('name:cashflow');
    expect(other.body.alias_conflicts).toEqual([{ alias: 'name:circtime', project_id: projectId }]);

    expect((await call('mProjects', 'POST', { bearer: tokens.manager, body: { git_remotes: ['not a url'] } })).status).toBe(400);
    expect((await call('mProjects', 'POST', { bearer: tokens.manager, body: { display_name: 'x', workspace: { device_id: 'w', device_kind: 'windows', directory: 'relative/dir' } } })).status).toBe(400);
  });

  it('resolves a project by remote, by workspace directory on a device, and by alias', async () => {
    const byRemote = await call('mResolve', 'GET', { bearer: tokens.reader, query: '?remote=' + encodeURIComponent('https://github.com/trance-0/circtime.git') });
    expect(byRemote.body).toMatchObject({ found: true, matched_by: 'remote', project: { id: projectId } });
    const byDir = await call('mResolve', 'GET', { bearer: tokens.reader, query: '?device_id=win-384de1b4&directory=' + encodeURIComponent('d:\\Documents\\Github\\circtime') });
    expect(byDir.body).toMatchObject({ found: true, matched_by: 'workspace' });
    expect(byDir.body.workspaces[0]).toMatchObject({ device_kind: 'windows', default_branch: 'main' });
    const byName = await call('mResolve', 'GET', { bearer: tokens.reader, query: '?name=CircTime' });
    expect(byName.body).toMatchObject({ found: true, matched_by: 'name', project: { id: projectId } });
    expect((await call('mResolve', 'GET', { bearer: tokens.reader, query: '?name=nothing-here' })).body).toEqual({ found: false });
    expect((await call('mResolve', 'GET', { bearer: tokens.reader })).status).toBe(400);
  });

  it('registers workspaces per machine; last_seen only moves forward; branch is last-writer-wins', async () => {
    const linux = await call('mWorkspaces', 'POST', { bearer: tokens.manager, body: { device_id: 'linux-1048b0a6', device_kind: 'linux', directory: '/home/me/workspace/circtime', default_branch: 'main', seen_at: '2026-10-02T10:00:00Z' } }, { id: projectId });
    expect(linux.status).toBe(201);
    const newer = await call('mWorkspaces', 'POST', { bearer: tokens.manager, body: { device_id: 'linux-1048b0a6', device_kind: 'linux', directory: '/home/me/workspace/circtime/', default_branch: 'dev', seen_at: '2026-10-03T10:00:00Z' } }, { id: projectId });
    expect(newer.body).toMatchObject({ created: false, changed: ['default_branch'], workspace: { default_branch: 'dev' } });
    const older = await call('mWorkspaces', 'POST', { bearer: tokens.manager, body: { device_id: 'linux-1048b0a6', device_kind: 'linux', directory: '/home/me/workspace/circtime', default_branch: 'old', seen_at: '2026-09-01T10:00:00Z' } }, { id: projectId });
    expect(older.body.workspace).toMatchObject({ default_branch: 'dev', last_seen_at: '2026-10-03T10:00:00.000Z' });
    const count = await raw`SELECT count(*)::int AS n FROM project_workspaces WHERE project_id = ${projectId}`;
    expect(count[0].n).toBe(2);
    expect((await call('mWorkspaces', 'POST', { bearer: tokens.manager, body: { device_id: 'x', device_kind: 'toaster', directory: '/x' } }, { id: projectId })).status).toBe(400);
    expect((await call('mWorkspaces', 'POST', { bearer: tokens.manager, body: { device_id: 'x', device_kind: 'linux', directory: '/x' } }, { id: 'prj_missing' })).status).toBe(404);
  });

  let conflictId = '';

  it('attaches sessions and keeps the latest context, logging the losing version from another machine', async () => {
    const key = encodeURIComponent('win-384de1b4:codex:019f');
    const first = await call('mContext', 'PATCH', { bearer: tokens.manager, body: { project_id: projectId, context_title: 'Deploy page', context_summary: 'windows summary', updated_at: '2026-11-01T10:00:00Z', device_id: 'win-384de1b4' } }, { key });
    expect(first.body).toMatchObject({ applied: ['project_id', 'context_title', 'context_summary'], conflicts: [] });
    // Linux edits the summary later without having seen the Windows one: kept, with a conflict.
    const linux = await call('mContext', 'PATCH', { bearer: tokens.manager, body: { context_summary: 'linux summary', updated_at: '2026-11-01T11:00:00Z', device_id: 'linux-1048b0a6' } }, { key });
    expect(linux.body.applied).toEqual(['context_summary']);
    expect(linux.body.conflicts).toHaveLength(1);
    conflictId = linux.body.conflicts[0];
    // A late Windows write with an older timestamp loses and is logged too.
    const stale = await call('mContext', 'PATCH', { bearer: tokens.manager, body: { context_summary: 'late windows', updated_at: '2026-11-01T10:30:00Z', device_id: 'win-384de1b4' } }, { key });
    expect(stale.body).toMatchObject({ applied: [], kept: ['context_summary'] });
    expect(stale.body.conflicts).toHaveLength(1);
    // Fast-forward from the current clock is not a conflict.
    const ff = await call('mContext', 'PATCH', { bearer: tokens.manager, body: { context_title: 'Deploy page via GitHub Actions', updated_at: '2026-11-01T12:00:00Z', device_id: 'linux-1048b0a6', base_updated_at: { context_title: '2026-11-01T10:00:00Z' } } }, { key });
    expect(ff.body).toMatchObject({ applied: ['context_title'], conflicts: [] });
    // A clock far in the future is clamped to receive time.
    const future = new Date(Date.now() + 3600_000).toISOString();
    const skew = await call('mContext', 'PATCH', { bearer: tokens.manager, body: { project_id: projectId, updated_at: future, device_id: 'linux-badclock' } }, { key });
    expect(skew.body.clock_skew).toBe(true);
    const [row] = await raw`SELECT project_id, context_title, context_summary, sync_clock_json FROM sessions WHERE external_key = 'win-384de1b4:codex:019f'`;
    expect(row).toMatchObject({ project_id: projectId, context_title: 'Deploy page via GitHub Actions', context_summary: 'linux summary' });
    expect(Date.parse(row.sync_clock_json.project_id.at)).toBeLessThanOrEqual(Date.now());
    // Raw transcript and title untouched.
    const [m] = await raw`SELECT content FROM messages WHERE id = 'msg_1'`;
    expect(m.content).toBe('deploy via actions');
    expect((await call('mContext', 'PATCH', { bearer: tokens.manager, body: { project_id: 'prj_missing', updated_at: '2026-11-01T10:00:00Z', device_id: 'w' } }, { key })).status).toBe(404);
    expect((await call('mContext', 'PATCH', { bearer: tokens.manager, body: { context_title: 'x', updated_at: '2026-11-01T10:00:00Z', device_id: 'w' } }, { key: 'no:such:key' })).status).toBe(404);
    expect((await call('mContext', 'PATCH', { bearer: tokens.manager, body: { context_title: 'x', updated_at: 'yesterday', device_id: 'w' } }, { key })).status).toBe(400);
  });

  it('merges message streams from two machines append-only by message id', async () => {
    const key = encodeURIComponent('win-384de1b4:codex:019f');
    const winBatch = [
      { external_id: 'oc-msg-2', role: 'assistant', content: 'reply', provider_timestamp: '2026-11-01T10:02:00Z' },
      { external_id: 'oc-msg-1', role: 'user', content: 'question', provider_timestamp: '2026-11-01T10:01:00Z' },
    ];
    const first = await call('mMerge', 'POST', { bearer: tokens.manager, body: { device_id: 'win-384de1b4', messages: winBatch } }, { key });
    expect(first.body).toMatchObject({ appended: 2, duplicates: 0, first_ordinal: 3 });
    const linux = await call('mMerge', 'POST', { bearer: tokens.manager, body: { device_id: 'linux-1048b0a6', messages: [...winBatch, { external_id: 'oc-msg-3', role: 'user', content: 'follow-up', provider_timestamp: '2026-11-01T10:03:00Z' }] } }, { key });
    expect(linux.body).toMatchObject({ appended: 1, duplicates: 2, first_ordinal: 5 });
    const rows = await raw`SELECT ordinal, content, external_message_id FROM messages WHERE session_id = 'ses_win_codex' ORDER BY ordinal`;
    expect(rows.map((r) => r.content)).toEqual(['deploy via actions', 'done', 'question', 'reply', 'follow-up']);
  });

  it('shows projects to admins, and to members only through their own sessions', async () => {
    await raw`UPDATE sessions SET project_id = ${projectId} WHERE id = 'ses_win_dsh'`;
    const adminList = await call('projects', 'GET', { browser: adminBrowser });
    expect(adminList.status).toBe(200);
    expect(adminList.body.projects.find((p: { id: string }) => p.id === projectId)).toMatchObject({ session_count: 2, workspace_count: 2 });
    const aliceList = await call('projects', 'GET', { browser: aliceBrowser });
    expect(aliceList.body.projects.map((p: { id: string }) => p.id)).not.toContain(projectId);
    expect((await call('project', 'GET', { browser: aliceBrowser }, { id: projectId })).status).toBe(403);
    expect((await call('project', 'GET', { browser: adminBrowser }, { id: 'prj_missing' })).status).toBe(404);
    // Alice's own session in a project makes that project (and only her session) visible.
    await call('sessionContext', 'PATCH', { browser: adminBrowser, body: { project_id: projectId } }, { id: 'ses_alice' });
    const detail = await call('project', 'GET', { browser: aliceBrowser }, { id: projectId });
    expect(detail.status).toBe(200);
    expect(detail.body.sessions.map((s: { id: string }) => s.id)).toEqual(['ses_alice']);
    expect(detail.body.conflicts).toEqual([]);
    const adminDetail = await call('project', 'GET', { browser: adminBrowser }, { id: projectId });
    expect(adminDetail.body.sessions).toHaveLength(3);
    expect(adminDetail.body.conflicts.length).toBeGreaterThanOrEqual(2);
    expect(adminDetail.body.project.aliases).toEqual(['name:circtime']);
    // Members cannot create, edit, attach or review.
    expect((await call('projects', 'POST', { browser: aliceBrowser, body: { display_name: 'mine' } })).status).toBe(403);
    expect((await call('project', 'PATCH', { browser: aliceBrowser, body: { display_name: 'x' } }, { id: projectId })).status).toBe(403);
    expect((await call('sessionContext', 'PATCH', { browser: aliceBrowser, body: { project_id: null } }, { id: 'ses_alice' })).status).toBe(403);
    expect((await call('conflicts', 'GET', { browser: aliceBrowser })).status).toBe(403);
    expect((await call('mergeRequest', 'POST', { browser: aliceBrowser }, { id: conflictId })).status).toBe(403);
    // CSRF still applies to the new UI writes.
    expect((await call('project', 'PATCH', { browser: { ...adminBrowser, csrf: 'wrong' }, body: { display_name: 'x' } }, { id: projectId })).status).toBe(403);
  });

  it('turns a conflict into a pending AI merge task that an agent completes', async () => {
    const open = await call('conflicts', 'GET', { browser: adminBrowser });
    expect(open.body.conflicts.find((c: { id: string }) => c.id === conflictId)).toMatchObject({ field: 'context_summary', kept: { value: 'linux summary' }, lost: { value: 'windows summary' } });
    const requested = await call('mergeRequest', 'POST', { browser: adminBrowser }, { id: conflictId });
    expect(requested.status).toBe(201);
    expect((await call('mergeRequest', 'POST', { browser: adminBrowser }, { id: conflictId })).body.created).toBe(false);
    const taskId = requested.body.merge_task.id;
    expect(requested.body.merge_task.versions.map((v: { value: string }) => v.value)).toEqual(['linux summary', 'windows summary']);
    // Agents see it with manage_projects only.
    expect((await call('mTasks', 'GET', { bearer: tokens.reader })).status).toBe(403);
    const pending = await call('mTasks', 'GET', { bearer: tokens.manager });
    expect(pending.body.merge_tasks.map((t: { id: string }) => t.id)).toContain(taskId);
    const done = await call('mComplete', 'POST', { bearer: tokens.manager, body: { value: 'merged: linux + windows summary' } }, { id: taskId });
    expect(done.status).toBe(200);
    expect(done.body.applied).toEqual(['context_summary']);
    expect((await call('mComplete', 'POST', { bearer: tokens.manager, body: { value: 'again' } }, { id: taskId })).status).toBe(409);
    const [row] = await raw`SELECT context_summary FROM sessions WHERE id = 'ses_win_codex'`;
    expect(row.context_summary).toBe('merged: linux + windows summary');
    const [c] = await raw`SELECT status FROM sync_conflicts WHERE id = ${conflictId}`;
    expect(c.status).toBe('resolved');
    // The merged write did not itself create a new conflict.
    const openAfter = await raw`SELECT count(*)::int AS n FROM sync_conflicts WHERE entity_id = 'ses_win_codex' AND status = 'open' AND lost_value_json = '"linux summary"'::jsonb`;
    expect(openAfter[0].n).toBe(0);
  });

  it('lets an admin dismiss a conflict and edit a project under the same policy', async () => {
    const [other] = await raw`SELECT id FROM sync_conflicts WHERE status = 'open' LIMIT 1`;
    expect((await call('conflict', 'PATCH', { browser: adminBrowser, body: { status: 'dismissed' } }, { id: other.id })).status).toBe(200);
    expect((await call('conflict', 'PATCH', { browser: adminBrowser, body: { status: 'dismissed' } }, { id: other.id })).status).toBe(404);
    const edit = await call('project', 'PATCH', { browser: adminBrowser, body: { display_name: 'circtime (site)', description: 'Personal homepage', add_aliases: ['name:circtime-site'] } }, { id: projectId });
    expect(edit.status).toBe(200);
    expect(edit.body.project).toMatchObject({ display_name: 'circtime (site)', description: 'Personal homepage' });
    expect(edit.body.fields.conflicts).toEqual([]);
    expect(edit.body.extended.aliases_added).toEqual(['name:circtime-site']);
  });

  it('never deleted anything: every pre-upgrade row is still there', async () => {
    for (const table of ['topics', 'users']) expect(Number((await raw.unsafe(`SELECT count(*)::int AS n FROM ${table}`))[0].n)).toBe(before[table]);
    expect(Number((await raw`SELECT count(*)::int AS n FROM sessions`)[0].n)).toBe(before.sessions);
    expect(Number((await raw`SELECT count(*)::int AS n FROM messages WHERE id IN ('msg_1', 'msg_2', 'msg_3')`)[0].n)).toBe(3);
  });
  it('adopts legacy message identities once, preserving IDs, ordinals and repeated identical turns', async () => {
    const { mergeSessionMessages } = await import('../src/lib/sync-store');
    await raw`INSERT INTO sessions (id, title) VALUES ('ses_legacy_ids', 'legacy migration')`;
    await raw`INSERT INTO messages (id, session_id, ordinal, role, content, provider, observed_at) VALUES
      ('msg_legacy_1', 'ses_legacy_ids', 1, 'user', 'ok', 'codex', now()),
      ('msg_legacy_2', 'ses_legacy_ids', 2, 'user', 'ok', 'codex', now())`;
    const input = [0, 1, 2].map(i => ({ external_id: `stable-${i}`, role: 'user' as const, content: 'ok', provider: 'codex' }));
    const first = await mergeSessionMessages('ses_legacy_ids', input, 'linux-test', 'test');
    expect(first).toMatchObject({ ok: true, adopted: 2, appended: 1 });
    const replay = await mergeSessionMessages('ses_legacy_ids', input, 'linux-test', 'test');
    expect(replay).toMatchObject({ ok: true, adopted: 0, appended: 0, duplicates: 3 });
    const rows = await raw`SELECT id, ordinal, external_message_id FROM messages WHERE session_id = 'ses_legacy_ids' ORDER BY ordinal`;
    expect((await raw`SELECT external_id FROM message_sync_keys WHERE session_id = 'ses_legacy_ids'`).length).toBe(2);
    expect(rows.slice(0, 2)).toEqual([
      { id: 'msg_legacy_1', ordinal: 1, external_message_id: null },
      { id: 'msg_legacy_2', ordinal: 2, external_message_id: null },
    ]);
  });

  it('keeps a compacted source resumable without recreating tasks or removed turns', async () => {
    const { ensureTaskByExternalKey } = await import('../src/lib/task-store');
    const { appendMessagesToSession } = await import('../src/lib/recording-store');
    const { mergeSessionMessages } = await import('../src/lib/sync-store');
    const sessionId = 'ses_import_mirror';
    const externalKey = 'dev:dsh:mirror';
    await raw`insert into tasks (id,title,external_key) values ('tsk_original','Canonical','dev:codex:original')`;
    await raw`insert into sessions (id,title,external_key,task_id) values (${sessionId},'Mirror',${externalKey},'tsk_original')`;
    const turn = { role: 'assistant' as const, content: 'original turn', provider_timestamp: '2026-04-01T01:00:00.000Z' };
    await raw`insert into import_compaction_receipts values (${sessionId},1,'msg_retired','assistant',${turn.provider_timestamp},encode(sha256(convert_to(${turn.content},'UTF8')),'hex'),true)`;
    const lookup = await ensureTaskByExternalKey({externalKey, title: 'Old mirror title'}, 'test');
    expect(lookup).toMatchObject({created: false, task: {id: 'tsk_original', title: 'Canonical'}});
    const append = (messages: Array<typeof turn>) => appendMessagesToSession({sessionId, messages, canRenameSession: false, actor: 'test'});
    expect(await append([turn])).toMatchObject({duplicates: 1});
    expect(await mergeSessionMessages(sessionId,[{...turn,external_id:'legacy'}],'dev','test')).toMatchObject({appended:0, duplicates:1});
    expect(await append([{...turn,provider_timestamp:'2026-04-02T01:00:00.000Z'}])).toMatchObject({duplicates:0,messages:[{ordinal:2}]});
    expect((await raw`select id from messages where session_id=${sessionId}`).length).toBe(1);
  });

  it('searches only authorized scopes and reads excerpts from current visible rows', async () => {
    await raw`insert into projects (id, canonical_key, display_name, owner_user_id) values
      ('prj_search','name:sample','Example','usr_alice'),('prj_search_private','name:hidden','Cipher',null)`;
    await raw`insert into project_aliases(alias_key,project_id) values ('name:cipher-tag','prj_search')`;
    await raw`insert into tasks (id,title) values ('tsk_search','Cipher launch')`;
    await raw`insert into sessions (id,title,owner_user_id) values ('ses_search','Notes','usr_alice')`;
    await raw`insert into messages (id,session_id,ordinal,role,content,observed_at) values
      ('msg_search','ses_search',1,'user',repeat('padding ',70)||'CIPHER transcript',now())`;
    const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ hits: { hits: [
      { _id: 'ses_win_codex' }, { _id: 'ses_search' }, // deliberately ignore the upstream ACL filter
    ] } }));
    const search = (scope: string, browser = aliceBrowser, q = 'cipher') => call('search', 'POST', { browser, body: { scope, q, mode: 'keyword' } });
    try {
      const { status, body } = await search('all');
      expect(status).toBe(200);
      expect(body.projects).toEqual([{ id: 'prj_search', title: 'Example', snippet: 'name:cipher-tag' }]);
      expect(body.tasks).toBeUndefined();
      expect(body.results).toHaveLength(1);
      expect(body.results[0]).toMatchObject({ id: 'ses_search', snippet: expect.stringMatching(/CIPHER transcript$/) });
      expect(body.results[0].snippet.length).toBeLessThanOrEqual(240);
      expect(upstream).toHaveBeenCalledTimes(1); // keyword mode doesn't call the embedder
      upstream.mockClear();
      expect((await search('tasks')).status).toBe(403);
      expect((await search('tasks', adminBrowser)).body.tasks).toEqual([{ id: 'tsk_search', title: 'Cipher launch' }]);
      expect((await search('projects', adminBrowser, '%')).body.projects).toEqual([]);
      expect((await search('invalid')).status).toBe(400);
      expect(upstream).not.toHaveBeenCalled();
      await raw`update messages set content='redacted' where id='msg_search'`;
      expect((await search('sessions')).body.results[0].snippet).toBeNull();
      await raw`insert into compactions(id,session_id,summary) values ('cmp_search','ses_search','Cipher summary')`;
      expect((await search('sessions')).body.results[0].snippet).toBe('Cipher summary');
      upstream.mockRejectedValue(new Error('offline'));
      expect((await search('all')).body).toMatchObject({ projects: [{ id: 'prj_search' }], sessionError: expect.any(String) });
      expect((await search('sessions')).status).toBe(503);
    } finally { upstream.mockRestore(); }
  });

});
