import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { PROJECT_SCHEMA_STATEMENTS, SCHEMA_STATEMENTS } from '../src/lib/setup-schema';
import { normalizePermissions } from '../src/lib/scoped-token';
import { createScopedTokenSchema } from '../src/lib/validations';

const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

describe('migration 013 (projects)', () => {
  it('deploy-init.js and drizzle/0013_projects.sql carry every statement', () => {
    const deployInit = squash(fs.readFileSync(path.join(__dirname, '../scripts/deploy-init.js'), 'utf8'));
    const sqlFile = squash(fs.readFileSync(path.join(__dirname, '../drizzle/0013_projects.sql'), 'utf8'));
    for (const statement of PROJECT_SCHEMA_STATEMENTS) {
      expect(deployInit).toContain(squash(statement));
      expect(sqlFile).toContain(squash(statement));
    }
    expect(deployInit).toContain("'013_projects'");
  });

  it('is additive: new tables, nullable or defaulted columns, indexes; nothing destructive', () => {
    for (const statement of PROJECT_SCHEMA_STATEMENTS) {
      expect(statement).toMatch(/^(CREATE TABLE IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS|ALTER TABLE (sessions|messages) ADD COLUMN IF NOT EXISTS)/);
      expect(statement).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM|UPDATE|RENAME)\b/);
      if (statement.startsWith('ALTER TABLE')) expect(statement).toMatch(/(NOT NULL DEFAULT|^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS \w+ text( REFERENCES [^ ]+ ON DELETE SET NULL)?$)/);
    }
  });

  it('runs after the identity tables it references', () => {
    const users = SCHEMA_STATEMENTS.findIndex((s) => s.startsWith('CREATE TABLE IF NOT EXISTS users'));
    const projects = SCHEMA_STATEMENTS.findIndex((s) => s.startsWith('CREATE TABLE IF NOT EXISTS projects'));
    expect(users).toBeGreaterThan(-1);
    expect(projects).toBeGreaterThan(users);
  });
});

describe('manage_projects scoped-token permission', () => {
  it.each([true, false])('preserves the UI selection %s through request validation', (selected) => {
    const request = createScopedTokenSchema.parse({
      name: 'session-sync', scope: 'global',
      permissions: { read_all: true, create_sessions: true, mint_tokens: true, manage_projects: selected },
    });
    expect(request.permissions).toHaveProperty('manage_projects', selected);
    expect(normalizePermissions(request.permissions, request.scope).manage_projects).toBe(selected);
  });

  it.each(['folder', 'session'] as const)('cannot grant project management through a %s request', (scope) => {
    const request = createScopedTokenSchema.parse({
      name: 'restricted', scope, folder_id: 'top_a', session_id: 'ses_a',
      permissions: { manage_projects: true },
    });
    expect(normalizePermissions(request.permissions, request.scope).manage_projects).toBe(false);
  });

  it('rejects non-boolean project permissions instead of silently discarding them', () => {
    expect(createScopedTokenSchema.safeParse({
      name: 'invalid', scope: 'global', permissions: { manage_projects: 'true' },
    }).success).toBe(false);
  });

  it('keeps legacy request payloads without the new checkbox restricted', () => {
    const request = createScopedTokenSchema.parse({
      name: 'older-client', scope: 'global', permissions: { read_all: true },
    });
    expect(normalizePermissions(request.permissions, request.scope).manage_projects).toBe(false);
  });

  it('is never granted implicitly to a token minted before it existed', () => {
    const legacy = { read_all: true, mint_tokens: true, create_sessions: true, create_folders: false, delete_folders: false, delete_sessions: false, rename_sessions: false };
    expect(normalizePermissions(legacy, 'global').manage_projects).toBe(false);
    expect(normalizePermissions({ ...legacy, manage_projects: true }, 'global').manage_projects).toBe(true);
  });

  it('defaults on for a new global token and is clamped off for folder and session tokens', () => {
    expect(normalizePermissions(undefined, 'global').manage_projects).toBe(true);
    expect(normalizePermissions({ manage_projects: true }, 'folder').manage_projects).toBe(false);
    expect(normalizePermissions({ manage_projects: true }, 'session').manage_projects).toBe(false);
  });
});
