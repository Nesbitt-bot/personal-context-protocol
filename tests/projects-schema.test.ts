import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { PROJECT_SCHEMA_STATEMENTS, SCHEMA_STATEMENTS } from '../src/lib/setup-schema';
import { normalizePermissions } from '../src/lib/scoped-token';

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
