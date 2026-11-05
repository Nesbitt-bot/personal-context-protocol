import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { canAccessSession, isValidPrincipal } from '../src/lib/session-access';
import { generateClaimCode, hashClaimCode, normalizeClaimCode } from '../src/lib/claims';
import { IDENTITY_SCHEMA_STATEMENTS, SERVICE_SCHEMA_STATEMENTS } from '../src/lib/setup-schema';
import { credentialAllowsPrincipal, isValidPrincipalPrefix } from '../src/lib/service-auth';
import { clampGrantTtl, groupPrincipalFor, MAX_GRANT_TTL_SECONDS, MIN_GRANT_TTL_SECONDS } from '../src/lib/turn-grants';

const admin = { isAdmin: true, userId: 'usr_admin' };
const alice = { isAdmin: false, userId: 'usr_alice' };
const bob = { isAdmin: false, userId: 'usr_bob' };
const aliceLinks = new Set(['telegram:111']);
const none = new Set<string>();

describe('session authorization', () => {
  it('admins see every session, including unowned and group sessions', () => {
    expect(canAccessSession(admin, { ownerUserId: null, principal: null, sessionClass: 'unattributed' }, none)).toBe(true);
    expect(canAccessSession(admin, { ownerUserId: 'usr_bob', principal: null, sessionClass: 'trusted' }, none)).toBe(true);
    expect(canAccessSession(admin, { ownerUserId: null, principal: 'telegram:-100', sessionClass: 'group' }, none)).toBe(true);
  });

  it('owners see their own sessions; others do not', () => {
    const owned = { ownerUserId: 'usr_alice', principal: null, sessionClass: 'trusted' };
    expect(canAccessSession(alice, owned, none)).toBe(true);
    expect(canAccessSession(bob, owned, none)).toBe(false);
  });

  it('a linked principal grants access to that principal\'s sessions', () => {
    const later = { ownerUserId: null, principal: 'telegram:111', sessionClass: 'trusted' };
    expect(canAccessSession(alice, later, aliceLinks)).toBe(true);
    expect(canAccessSession(bob, later, none)).toBe(false);
  });

  it('unowned sessions and group sessions are admin-only', () => {
    expect(canAccessSession(alice, { ownerUserId: null, principal: null, sessionClass: 'unattributed' }, aliceLinks)).toBe(false);
    expect(canAccessSession(alice, { ownerUserId: 'usr_alice', principal: 'telegram:111', sessionClass: 'group' }, aliceLinks)).toBe(false);
  });
});

describe('claim codes', () => {
  it('generates 20 Crockford base32 characters in groups of five', () => {
    const code = generateClaimCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
    expect(generateClaimCode()).not.toBe(code);
  });

  it('normalizes case, separators and look-alike characters', () => {
    const code = generateClaimCode();
    expect(normalizeClaimCode(code.toLowerCase())).toBe(code.replace(/-/g, ''));
    expect(normalizeClaimCode(` ${code.replace(/-/g, ' ')} `)).toBe(code.replace(/-/g, ''));
    expect(normalizeClaimCode('OOOOO-IIIII-LLLLL-00000')).toBe('00000111111111100000');
  });

  it('rejects malformed codes', () => {
    expect(normalizeClaimCode('')).toBeNull();
    expect(normalizeClaimCode('ABC')).toBeNull();
    expect(normalizeClaimCode('UUUUU-UUUUU-UUUUU-UUUUU')).toBeNull();
    expect(normalizeClaimCode(42)).toBeNull();
    expect(normalizeClaimCode('A'.repeat(100))).toBeNull();
  });

  it('stores a hash, never the code', () => {
    const normalized = normalizeClaimCode(generateClaimCode())!;
    const hash = hashClaimCode(normalized);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(normalized);
  });
});

describe('principals', () => {
  it('accepts platform principals', () => {
    for (const ok of ['telegram:100000001', 'openclaw-weixin:wxid-test-0001@im.wechat', 'astrbot:qq:123456']) {
      expect(isValidPrincipal(ok)).toBe(true);
    }
  });

  it('rejects malformed principals', () => {
    for (const bad of ['', 'telegram', 'Telegram:1', 'telegram:', 'a:b c', 'x:'.repeat(200), 'telegram:1:2:3:4']) {
      expect(isValidPrincipal(bad)).toBe(false);
    }
  });
});

describe('identity migration 011', () => {
  const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

  it('deploy-init.js carries every identity statement', () => {
    const deployInit = squash(fs.readFileSync(path.join(__dirname, '../scripts/deploy-init.js'), 'utf8'));
    for (const statement of IDENTITY_SCHEMA_STATEMENTS) expect(deployInit).toContain(squash(statement));
  });

  it('drizzle/0011_identity.sql carries every identity statement', () => {
    const sqlFile = squash(fs.readFileSync(path.join(__dirname, '../drizzle/0011_identity.sql'), 'utf8'));
    for (const statement of IDENTITY_SCHEMA_STATEMENTS) expect(sqlFile).toContain(squash(statement));
  });

  it('only adds tables, nullable or defaulted columns and indexes (no destructive statements)', () => {
    for (const statement of IDENTITY_SCHEMA_STATEMENTS) {
      expect(statement).toMatch(/^(CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS|ALTER TABLE sessions ADD COLUMN IF NOT EXISTS)/);
      expect(statement).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM|UPDATE)\b/);
    }
  });
});

describe('migration 012 (service sync)', () => {
  const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

  it('deploy-init.js and drizzle/0012_service_sync.sql carry every statement', () => {
    const deployInit = squash(fs.readFileSync(path.join(__dirname, '../scripts/deploy-init.js'), 'utf8'));
    const sqlFile = squash(fs.readFileSync(path.join(__dirname, '../drizzle/0012_service_sync.sql'), 'utf8'));
    for (const statement of SERVICE_SCHEMA_STATEMENTS) {
      expect(deployInit).toContain(squash(statement));
      expect(sqlFile).toContain(squash(statement));
      expect(statement).toMatch(/^(CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS)/);
    }
  });
});

describe('service credential principal scope', () => {
  it('only allows principals under the configured prefixes', () => {
    expect(credentialAllowsPrincipal(['telegram:', 'openclaw-weixin:'], 'telegram:123')).toBe(true);
    expect(credentialAllowsPrincipal(['telegram:', 'openclaw-weixin:'], 'openclaw-weixin:abc')).toBe(true);
    expect(credentialAllowsPrincipal(['telegram:'], 'astrbot:qq:1')).toBe(false);
    expect(credentialAllowsPrincipal(['astrbot:'], 'astrbot:qq:1')).toBe(true);
    expect(credentialAllowsPrincipal([], 'telegram:1')).toBe(false);
  });

  it('a prefix must name a whole platform segment', () => {
    expect(isValidPrincipalPrefix('telegram:')).toBe(true);
    expect(isValidPrincipalPrefix('tele')).toBe(false);
    expect(isValidPrincipalPrefix('')).toBe(false);
    expect(credentialAllowsPrincipal(['tele'], 'telegram:1')).toBe(false);
  });
});

describe('turn grant helpers', () => {
  it('clamps the grant TTL', () => {
    expect(clampGrantTtl(undefined)).toBe(600);
    expect(clampGrantTtl(1)).toBe(MIN_GRANT_TTL_SECONDS);
    expect(clampGrantTtl(10 ** 9)).toBe(MAX_GRANT_TTL_SECONDS);
    expect(clampGrantTtl(120)).toBe(120);
  });

  it('derives a platform-scoped group principal', () => {
    expect(groupPrincipalFor('telegram:42', '-1001')).toBe('telegram:group:-1001');
    expect(groupPrincipalFor('astrbot:qq:42', '777')).toBe('astrbot:qq:group:777');
  });
});
