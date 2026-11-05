#!/usr/bin/env node
/**
 * PCP operator CLI: mint, list and revoke machine credentials without a
 * browser login, for the host operator only.
 *
 *   node scripts/pcp-operator.js service-credential create --name openclaw-pcp \
 *        --prefix telegram: --prefix openclaw-weixin: --token-out /path/file
 *   node scripts/pcp-operator.js service-credential list
 *   node scripts/pcp-operator.js service-credential revoke --id svc_...
 *   node scripts/pcp-operator.js scoped-token create --name session-import \
 *        --permission read_all --permission create_sessions --permission mint_tokens \
 *        [--expires 30d] --token-out /path/file
 *   node scripts/pcp-operator.js scoped-token list
 *   node scripts/pcp-operator.js scoped-token revoke --id stk_...
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
 *   never admin. Scoped tokens get exactly the permissions named with
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
const PERMISSION_KEYS = ['create_folders', 'delete_folders', 'create_sessions', 'delete_sessions', 'mint_tokens', 'rename_sessions', 'read_all'];
const SCOPES = ['global', 'folder', 'session'];

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

function validateServiceCreate(opts) {
  const name = (opts.name || '').trim();
  if (!name || name.length > 100) throw new Error('--name is required (1-100 characters)');
  if (opts.prefix.length === 0) throw new Error('at least one --prefix is required (e.g. telegram:)');
  for (const prefix of opts.prefix) {
    if (!PRINCIPAL_PREFIX_PATTERN.test(prefix)) throw new Error(`invalid principal prefix "${prefix}" (expected e.g. telegram:)`);
  }
  if (!opts.token_out) throw new Error('--token-out FILE (or - for a pipe) is required');
  return { name, prefixes: [...new Set(opts.prefix)], expires: opts.expires || 'never' };
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
    // Write the secret first, so a failed write never leaves an unusable row.
    deliverToken(opts.token_out, token);
    await sql`INSERT INTO service_credentials (id, name, token_hash, salt, token_prefix, principal_prefixes_json, revoked, created_at, expires_at)
              VALUES (${id}, ${input.name}, ${tokenHash}, ${salt}, ${token.substring(0, 16)}, ${sql.json(input.prefixes)}, false, ${now}, ${expiresAt})`;
    await audit(sql, 'service_credential.created', { credential_id: id, name: input.name, principal_prefixes: input.prefixes, by: 'operator-cli' });
    return { id, name: input.name, principal_prefixes: input.prefixes, expires_at: expiresAt };
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
      ? sql`SELECT id, name, principal_prefixes_json AS principal_prefixes, revoked, created_at, expires_at, last_used_at FROM service_credentials ORDER BY created_at`
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
  throw new Error('usage: pcp-operator.js <service-credential|scoped-token> <create|list|revoke> [options]');
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  // Loaded lazily so the pure helpers can be unit-tested without a database.
  const postgres = require('postgres');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => undefined });
  try {
    report(await run(sql, parsed));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

module.exports = { generateToken, hashToken, explicitPermissions, parseArgs, validateServiceCreate, validateScopedCreate, deliverToken, resolveExpiresAt, SERVICE_TOKEN_PREFIX, PRINCIPAL_PREFIX_PATTERN, PERMISSION_KEYS, run };

// `node - <args> < pcp-operator.js` (stdin) has no require.main, so also accept that.
if (require.main === module || module.id === '[stdin]' || module.filename === '[stdin]') {
  main().catch((error) => {
    process.stderr.write(`pcp-operator: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
