/**
 * The operator CLI (scripts/pcp-operator.js) must mint credentials exactly the
 * way the admin API routes do, so the app accepts what it creates.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { hashToken as libHash, verifyToken } from '@/lib/auth';
import { normalizePermissions, PERMISSION_KEYS } from '@/lib/scoped-token';
import { PRINCIPAL_PREFIX_PATTERN, SERVICE_TOKEN_PREFIX, credentialAllowsPrincipal } from '@/lib/service-auth';
import { EXPIRATION_CHOICES } from '@/lib/token-expiration';

const require = createRequire(import.meta.url);
const cli = require('../scripts/pcp-operator.js');

describe('operator CLI', () => {
  it('hashes tokens the same way as src/lib/auth.ts', async () => {
    const token = `${cli.SERVICE_TOKEN_PREFIX}${cli.generateToken()}`;
    const hash = await cli.hashToken(token, 'abcd1234abcd1234');
    expect(hash).toBe(await libHash(token, 'abcd1234abcd1234'));
    expect(await verifyToken(token, hash, 'abcd1234abcd1234')).toBe(true);
  });

  it('uses the same token prefix, principal pattern and permission keys as the app', () => {
    expect(cli.SERVICE_TOKEN_PREFIX).toBe(SERVICE_TOKEN_PREFIX);
    expect(cli.PRINCIPAL_PREFIX_PATTERN.source).toBe(PRINCIPAL_PREFIX_PATTERN.source);
    expect([...cli.PERMISSION_KEYS]).toEqual([...PERMISSION_KEYS]);
    expect(cli.generateToken()).toMatch(/^[0-9a-f]{64}$/);
    for (const choice of EXPIRATION_CHOICES) expect(() => cli.resolveExpiresAt(choice, new Date())).not.toThrow();
    expect(() => cli.resolveExpiresAt('forever', new Date())).toThrow();
  });

  it('grants only the named scoped-token permissions, clamped like the app', () => {
    const perms = cli.explicitPermissions(['read_all', 'create_sessions', 'mint_tokens'], 'global');
    expect(perms).toEqual({ create_folders: false, delete_folders: false, create_sessions: true, delete_sessions: false, mint_tokens: true, rename_sessions: false, read_all: true, manage_projects: false });
    // The stored value survives the app's own normalization unchanged.
    expect(normalizePermissions(perms, 'global')).toEqual(perms);
    expect(cli.explicitPermissions(['read_all', 'mint_tokens'], 'session').read_all).toBe(false);
    expect(() => cli.explicitPermissions(['admin'], 'global')).toThrow(/unknown permission/);
  });

  it('validates service credentials as platform-scoped, never unbounded', () => {
    const { opts } = cli.parseArgs(['service-credential', 'create', '--name', 'openclaw-pcp', '--prefix', 'telegram:', '--prefix', 'openclaw-weixin:', '--token-out', '-']);
    const input = cli.validateServiceCreate(opts);
    expect(input.prefixes).toEqual(['telegram:', 'openclaw-weixin:']);
    expect(credentialAllowsPrincipal(input.prefixes, 'telegram:100000001')).toBe(true);
    expect(credentialAllowsPrincipal(input.prefixes, 'astrbot:qq:1')).toBe(false);
    expect(() => cli.validateServiceCreate({ ...opts, prefix: [] })).toThrow(/prefix/);
    expect(() => cli.validateServiceCreate({ ...opts, prefix: ['*'] })).toThrow(/invalid principal prefix/);
    expect(() => cli.validateServiceCreate({ ...opts, token_out: undefined })).toThrow(/token-out/);
  });

  it('requires explicit permissions for scoped tokens', () => {
    const { opts } = cli.parseArgs(['scoped-token', 'create', '--name', 'import', '--token-out', '/tmp/x']);
    expect(() => cli.validateScopedCreate(opts)).toThrow(/--permission/);
    const ok = cli.validateScopedCreate({ ...opts, permission: ['read_all'] });
    expect(ok.scope).toBe('global');
    expect(ok.expires).toBe('30d');
  });

  it('never prints a token to a terminal and writes files with mode 600 without overwriting', () => {
    expect(() => cli.deliverToken('-', 'secret', { stdout: { isTTY: true, write: () => true }, fs })).toThrow(/terminal/);
    let piped = '';
    cli.deliverToken('-', 'secret', { stdout: { isTTY: false, write: (s: string) => { piped += s; return true; } }, fs });
    expect(piped).toBe('secret\n');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcp-op-'));
    const file = path.join(dir, 'token');
    cli.deliverToken(file, 'secret');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(file, 'utf8')).toBe('secret\n');
    expect(() => cli.deliverToken(file, 'other')).toThrow();
    fs.rmSync(dir, { recursive: true });
  });
});
