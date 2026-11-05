#!/usr/bin/env node
/**
 * PCP operator CLI: mint, list and revoke machine credentials without a
 * browser login, for the host operator only.
 *
 *   node scripts/pcp-operator.js service-credential create --name openclaw-pcp \
 *        --prefix telegram: --prefix openclaw-weixin: --token-out /path/file
 *   node scripts/pcp-operator.js service-credential create --kind ingress --name astrbot-ingress \
 *        --prefix astrbot: --token-out FILE --signing-key-out FILE   (needs PCP_INSTANCE_SECRET)
 *   node scripts/pcp-operator.js service-credential create --kind broker --name pcp-broker \
 *        --delegate svc_<openclaw-pcp> --token-out FILE
 *   node scripts/pcp-operator.js service-credential list
 *   node scripts/pcp-operator.js service-credential revoke --id svc_...
 *   node scripts/pcp-operator.js scoped-token create --name session-import \
 *        --permission read_all --permission create_sessions --permission mint_tokens \
 *        [--expires 30d] --token-out /path/file
 *   node scripts/pcp-operator.js scoped-token list
 *   node scripts/pcp-operator.js scoped-token revoke --id stk_...
 *   node scripts/pcp-operator.js user list
 *   node scripts/pcp-operator.js identity link --principal telegram:123 --user usr_...
 *   node scripts/pcp-operator.js identity list | identity unlink --principal telegram:123
 *   node scripts/pcp-operator.js sessions export > pcp-sessions.json
 *       (read-only transaction: id, external_key, title, project_id per
 *       session, for thirdparty/pcp-session-import/organize-projects.mjs)
 *
 * It connects with DATABASE_URL, so run it where the app runs, e.g.
 *   docker exec -i -w /app <app-container> node - <args> < scripts/pcp-operator.js
 *
 * Rules (mirroring the admin API routes, see tests/operator-cli.test.ts):
 * - Tokens use the same format and salted scrypt hash as src/lib/auth.ts and
 *   src/lib/service-auth.ts; only the hash is stored.
 * - The plaintext token is NEVER printed to a terminal. `--token-out FILE`
 *   writes it to a new file with mode 600 (refuses to overwrite);
 *   `--token-out -` writes only the token to stdout and refuses when stdout is
 *   a TTY, so it can be piped straight into a private file elsewhere.
 *   Metadata (id, name, scope) goes to stderr as JSON.
 * - Service credentials are platform-scoped by principal prefixes and are
 *   never admin. Kinds (src/lib/service-auth.ts): `channel` (plugins; never
 *   the reserved `astrbot:` prefix), `ingress` (exactly `astrbot:`; its HMAC
 *   signing key is derived from PCP_INSTANCE_SECRET and delivered once like
 *   the token), `broker` (no prefixes; `--delegate` names the channel
 *   credential whose tools may read broker turn grants).
 * - `identity link` is the operator form of an admin link (link_method
 *   'admin'); a principal links to at most one user. Scoped tokens get exactly the permissions named with
 *   `--permission`; everything else is false (no full-permission default).
 * - Every create/revoke writes an `events` audit row with actor `operator`.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);

const SERVICE_TOKEN_PREFIX = 'pcps_';
const PRINCIPAL_PREFIX_PATTERN = /^[a-z][a-z0-9_-]{0,63}:$/;
const EXPIRATION_CHOICES = ['1h', '24h', '7d', '30d', 'never'];
const DURATION_MS = { '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };
const PERMISSION_KEYS = ['create_folders', 'delete_folders', 'create_sessions', 'delete_sessions', 'mint_tokens', 'rename_sessions', 'read_all', 'manage_projects'];
const SCOPES = ['global', 'folder', 'session'];
const CREDENTIAL_KINDS = ['channel', 'ingress', 'broker'];
const INGRESS_PREFIX = 'astrbot:';
// Mirrors PCP src/lib/session-access.ts PRINCIPAL_PATTERN.
const PRINCIPAL_PATTERN = /^[a-z][a-z0-9_-]{0,63}(:[A-Za-z0-9._@+=-]{1,128}){1,3}$/;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}
async function hashToken(token, salt) {
  const hash = await scryptAsync(token, salt, 32);
  return `scrypt:${hash.toString('hex')}`;
}
function createId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex').slice(0, 8)}`;
}
function resolveExpiresAt(choice, now) {
  if (!EXPIRATION_CHOICES.includes(choice)) throw new Error(`--expires must be one of ${EXPIRATION_CHOICES.join(', ')}`);
  return choice === 'never' ? null : new Date(now.getTime() + DURATION_MS[choice]);
}

/** Exactly the named permissions, then clamped like src/lib/scoped-token.ts. */
function explicitPermissions(names, scope) {
  const perms = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, false]));
  for (const name of names) {
    if (!PERMISSION_KEYS.includes(name)) throw new Error(`unknown permission "${name}" (allowed: ${PERMISSION_KEYS.join(', ')})`);
    perms[name] = true;
  }
  if (scope === 'folder' || scope === 'session') {
    perms.create_folders = false;
    perms.delete_folders = false;
    perms.manage_projects = false;
  }
  if (scope === 'session') {
    perms.create_sessions = false;
    perms.delete_sessions = false;
    perms.mint_tokens = false;
    perms.read_all = false;
  }
  return perms;
}

function parseArgs(argv) {
  const [kind, action, ...rest] = argv;
  const opts = { prefix: [], permission: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument "${arg}"`);
    const key = arg.slice(2);
    const value = rest[i + 1];
    if (value === undefined || (value.startsWith('--') && value !== '-')) throw new Error(`${arg} needs a value`);
    i += 1;
    if (key === 'prefix' || key === 'permission') opts[key].push(...value.split(',').filter(Boolean));
    else opts[key.replace(/-/g, '_')] = value;
  }
  return { kind, action, opts };
}

/** Same shape rules as credentialShapeError in src/lib/service-auth.ts. */
function validateServiceCreate(opts) {
  const name = (opts.name || '').trim();
  if (!name || name.length > 100) throw new Error('--name is required (1-100 characters)');
  const kind = opts.kind || 'channel';
  if (!CREDENTIAL_KINDS.includes(kind)) throw new Error(`--kind must be one of ${CREDENTIAL_KINDS.join(', ')}`);
  for (const prefix of opts.prefix) {
    if (!PRINCIPAL_PREFIX_PATTERN.test(prefix)) throw new Error(`invalid principal prefix "${prefix}" (expected e.g. telegram:)`);
  }
  const prefixes = [...new Set(opts.prefix)];
  if (kind === 'channel') {
    if (prefixes.length === 0) throw new Error('at least one --prefix is required (e.g. telegram:)');
    if (prefixes.includes(INGRESS_PREFIX)) throw new Error(`the ${INGRESS_PREFIX} prefix is reserved for --kind ingress`);
  }
  if (kind === 'ingress' && (prefixes.length !== 1 || prefixes[0] !== INGRESS_PREFIX)) throw new Error(`an ingress credential takes exactly --prefix ${INGRESS_PREFIX}`);
  if (kind === 'broker' && prefixes.length > 0) throw new Error('a broker credential takes no --prefix');
  if (opts.delegate && kind !== 'broker') throw new Error('--delegate is only for --kind broker');
  if (kind === 'broker' && opts.delegate && !/^svc_[A-Za-z0-9_]+$/.test(opts.delegate)) throw new Error('--delegate must be a service credential id (svc_...)');
  if (kind === 'ingress' && !opts.signing_key_out) throw new Error('--signing-key-out FILE (or -) is required for an ingress credential');
  if (kind !== 'ingress' && opts.signing_key_out) throw new Error('--signing-key-out is only for --kind ingress');
  if (!opts.token_out) throw new Error('--token-out FILE (or - for a pipe) is required');
  if (opts.token_out === '-' && opts.signing_key_out === '-') throw new Error('--token-out and --signing-key-out cannot both be -');
  return { name, kind, prefixes, delegate: opts.delegate || null, expires: opts.expires || 'never' };
}

/** Same derivation as deriveIngressSigningKey in src/lib/service-auth.ts. */
function deriveIngressSigningKey(credentialId, instanceSecret) {
  if (!instanceSecret || instanceSecret.trim().length < 32) throw new Error('PCP_INSTANCE_SECRET is not set; run this inside the app container');
  return crypto.createHmac('sha256', instanceSecret).update(`pcp-astrbot-ingress-signing:v1:${credentialId}`).digest('hex');
}

function validateScopedCreate(opts) {
  const name = (opts.name || '').trim();
  if (!name || name.length > 100) throw new Error('--name is required (1-100 characters)');
  const scope = opts.scope || 'global';
  if (!SCOPES.includes(scope)) throw new Error(`--scope must be one of ${SCOPES.join(', ')}`);
  if (scope === 'folder' && !opts.folder_id) throw new Error('--folder-id is required for a folder token');
  if (scope === 'session' && !opts.session_id) throw new Error('--session-id is required for a session token');
  if (opts.permission.length === 0 && scope !== 'session') throw new Error('name every permission with --permission (no full-permission default)');
  if (!opts.token_out) throw new Error('--token-out FILE (or - for a pipe) is required');
  return {
    name,
    scope,
    folderId: scope === 'folder' ? opts.folder_id : null,
    sessionId: scope === 'session' ? opts.session_id : null,
    permissions: explicitPermissions(opts.permission, scope),
    expires: opts.expires || '30d',
  };
}

/** Deliver the plaintext token without ever showing it on a terminal. */
function deliverToken(target, token, io = { stdout: process.stdout, fs }) {
  if (target === '-') {
    if (io.stdout.isTTY) throw new Error('refusing to print a token to a terminal; pipe it or use --token-out FILE');
    io.stdout.write(`${token}\n`);
    return;
  }
  const fd = io.fs.openSync(target, 'wx', 0o600);
  try {
    io.fs.writeSync(fd, `${token}\n`);
  } finally {
    io.fs.closeSync(fd);
  }
  io.fs.chmodSync(target, 0o600);
}

function report(value) {
  process.stderr.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function audit(sql, action, details) {
  await sql`INSERT INTO events (id, action, actor, details_json, created_at)
            VALUES (${createId('evt')}, ${action}, 'operator', ${sql.json(details)}, now())`;
}

async function run(sql, { kind, action, opts }) {
  const now = new Date();
  if (kind === 'service-credential' && action === 'create') {
    const input = validateServiceCreate(opts);
    const expiresAt = resolveExpiresAt(input.expires, now);
    const token = `${SERVICE_TOKEN_PREFIX}${generateToken()}`;
    const salt = generateSalt();
    const id = createId('svc');
    const tokenHash = await hashToken(token, salt);
    if (input.delegate) {
      const rows = await sql`SELECT id FROM service_credentials WHERE id = ${input.delegate} AND kind = 'channel' AND NOT revoked`;
      if (rows.length === 0) throw new Error('--delegate must name a live channel credential');
    }
    const signingKey = input.kind === 'ingress' ? deriveIngressSigningKey(id, process.env.PCP_INSTANCE_SECRET) : null;
    // Write the secrets first, so a failed write never leaves an unusable row.
    deliverToken(opts.token_out, token);
    if (signingKey) deliverToken(opts.signing_key_out, signingKey);
    await sql`INSERT INTO service_credentials (id, name, token_hash, salt, token_prefix, principal_prefixes_json, kind, delegate_credential_id, revoked, created_at, expires_at)
              VALUES (${id}, ${input.name}, ${tokenHash}, ${salt}, ${token.substring(0, 16)}, ${sql.json(input.prefixes)}, ${input.kind}, ${input.delegate}, false, ${now}, ${expiresAt})`;
    await audit(sql, 'service_credential.created', { credential_id: id, name: input.name, kind: input.kind, principal_prefixes: input.prefixes, delegate: input.delegate, by: 'operator-cli' });
    return { id, name: input.name, kind: input.kind, principal_prefixes: input.prefixes, delegate: input.delegate, expires_at: expiresAt };
  }
  if (kind === 'scoped-token' && action === 'create') {
    const input = validateScopedCreate(opts);
    if (input.folderId) {
      const rows = await sql`SELECT id FROM topics WHERE id = ${input.folderId}`;
      if (rows.length === 0) throw new Error('folder not found');
    }
    if (input.sessionId) {
      const rows = await sql`SELECT id FROM sessions WHERE id = ${input.sessionId}`;
      if (rows.length === 0) throw new Error('session not found');
    }
    const expiresAt = resolveExpiresAt(input.expires, now);
    const token = generateToken();
    const salt = generateSalt();
    const id = createId('stk');
    const tokenHash = await hashToken(token, salt);
    deliverToken(opts.token_out, token);
    await sql`INSERT INTO scoped_tokens (id, token_hash, salt, token_prefix, name, scope, folder_id, session_id, permissions_json, revoked, created_at, expires_at)
              VALUES (${id}, ${tokenHash}, ${salt}, ${token.substring(0, 16)}, ${input.name}, ${input.scope}, ${input.folderId}, ${input.sessionId}, ${sql.json(input.permissions)}, false, ${now}, ${expiresAt})`;
    await sql`INSERT INTO events (id, session_id, topic_id, action, actor, details_json, created_at)
              VALUES (${createId('evt')}, ${input.sessionId}, ${input.folderId}, 'token.created', 'operator',
                      ${sql.json({ token_id: id, token_name: input.name, scope: input.scope, permissions: input.permissions, by: 'operator-cli' })}, now())`;
    return { id, name: input.name, scope: input.scope, permissions: input.permissions, expires_at: expiresAt };
  }
  if (action === 'list' && (kind === 'service-credential' || kind === 'scoped-token')) {
    return kind === 'service-credential'
      ? sql`SELECT id, name, kind, principal_prefixes_json AS principal_prefixes, delegate_credential_id AS delegate, revoked, created_at, expires_at, last_used_at FROM service_credentials ORDER BY created_at`
      : sql`SELECT id, name, scope, folder_id, session_id, permissions_json AS permissions, revoked, created_at, expires_at, last_used_at FROM scoped_tokens ORDER BY created_at`;
  }
  if (action === 'revoke' && (kind === 'service-credential' || kind === 'scoped-token')) {
    if (!opts.id) throw new Error('--id is required');
    const rows = kind === 'service-credential'
      ? await sql`UPDATE service_credentials SET revoked = true WHERE id = ${opts.id} RETURNING id`
      : await sql`UPDATE scoped_tokens SET revoked = true WHERE id = ${opts.id} RETURNING id`;
    if (rows.length === 0) throw new Error('credential not found');
    await audit(sql, kind === 'service-credential' ? 'service_credential.revoked' : 'token.revoked', { credential_id: opts.id, by: 'operator-cli' });
    return { id: opts.id, revoked: true };
  }
  if (kind === 'sessions' && action === 'export') return exportSessions(sql);
  if (kind === 'user' && action === 'list') {
    return sql`SELECT id, display_name, is_admin, created_at, last_login_at FROM users ORDER BY created_at`;
  }
  if (kind === 'identity') return identityCommand(sql, action, opts);
  throw new Error('usage: pcp-operator.js <service-credential|scoped-token> <create|list|revoke> [options] | user list | identity <link|unlink|list> | sessions export');
}

function validatePrincipal(value) {
  const principal = String(value || '').trim();
  if (!PRINCIPAL_PATTERN.test(principal) || principal.length > 300) throw new Error('--principal must look like platform:id (e.g. telegram:123, astrbot:qq:456)');
  if (principal.includes(':group:')) throw new Error('group principals cannot be linked to a user');
  return principal;
}

/** Operator identity links (link_method 'admin'), audited like the admin API. */
async function identityCommand(sql, action, opts) {
  if (action === 'list') return sql`SELECT principal, user_id, link_method, linked_at FROM identities ORDER BY linked_at`;
  const principal = validatePrincipal(opts.principal);
  if (action === 'link') {
    if (!opts.user || !/^usr_[A-Za-z0-9_]+$/.test(opts.user)) throw new Error('--user usr_... is required');
    const users = await sql`SELECT id FROM users WHERE id = ${opts.user}`;
    if (users.length === 0) throw new Error('user not found');
    const existing = await sql`SELECT user_id FROM identities WHERE principal = ${principal}`;
    if (existing.length > 0 && existing[0].user_id !== opts.user) throw new Error('that principal is linked to another user; unlink it first');
    if (existing.length === 0) {
      await sql`INSERT INTO identities (principal, user_id, link_method, linked_at) VALUES (${principal}, ${opts.user}, 'admin', now())`;
      // Its DM session (if any) becomes owned, as a claim would do.
      await sql`UPDATE sessions SET owner_user_id = ${opts.user}, updated_at = now() WHERE principal = ${principal} AND class = 'trusted' AND owner_user_id IS NULL`;
      await audit(sql, 'identity.linked', { principal, user_id: opts.user, by: 'operator-cli' });
    }
    return { principal, user_id: opts.user, linked: true, already: existing.length > 0 };
  }
  if (action === 'unlink') {
    const rows = await sql`DELETE FROM identities WHERE principal = ${principal} RETURNING user_id`;
    if (rows.length === 0) throw new Error('principal is not linked');
    await audit(sql, 'identity.unlinked', { principal, user_id: rows[0].user_id, by: 'operator-cli' });
    return { principal, unlinked: true };
  }
  throw new Error('usage: pcp-operator.js identity <link --principal P --user usr_...|unlink --principal P|list>');
}

/**
 * Session identities for project planning, read in a READ ONLY transaction so
 * the export can run against production without writing anything. Message
 * content is never included. Works before and after migration 013.
 */
async function exportSessions(sql) {
  return sql.begin('read only', async (tx) => {
    const [col] = await tx`SELECT 1 AS ok FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'project_id'`;
    const rows = col
      ? await tx`SELECT id, external_key, title, project_id, archived FROM sessions ORDER BY id`
      : await tx`SELECT id, external_key, title, NULL::text AS project_id, archived FROM sessions ORDER BY id`;
    const [version] = await tx`SELECT max(version) AS v FROM schema_migrations`;
    return { exported_at: new Date().toISOString(), schema_version: version ? version.v : null, has_projects: Boolean(col), sessions: rows };
  });
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  // Loaded lazily so the pure helpers can be unit-tested without a database.
  const postgres = require('postgres');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => undefined });
  try {
    const result = await run(sql, parsed);
    // The export is data for another tool: stdout. Everything else is metadata on stderr.
    if (parsed.kind === 'sessions') process.stdout.write(`${JSON.stringify(result)}\n`);
    else report(result);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

module.exports = { generateToken, hashToken, explicitPermissions, parseArgs, validateServiceCreate, validateScopedCreate, validatePrincipal, deriveIngressSigningKey, deliverToken, resolveExpiresAt, SERVICE_TOKEN_PREFIX, PRINCIPAL_PREFIX_PATTERN, PERMISSION_KEYS, CREDENTIAL_KINDS, run, exportSessions };

// `node - <args> < pcp-operator.js` (stdin) has no require.main, so also accept that.
if (require.main === module || module.id === '[stdin]' || module.filename === '[stdin]') {
  main().catch((error) => {
    process.stderr.write(`pcp-operator: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
