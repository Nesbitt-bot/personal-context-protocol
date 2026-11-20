import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { ACCESS_CODE_SCHEMA_STATEMENTS, SCHEMA_STATEMENTS } from '../src/lib/setup-schema';

const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

describe('migration 019 (access codes)', () => {
  it('deploy-init.js and drizzle/019_access_codes.sql carry every statement', () => {
    const deployInit = squash(fs.readFileSync(path.join(__dirname, '../scripts/deploy-init.js'), 'utf8'));
    const sqlFile = squash(fs.readFileSync(path.join(__dirname, '../drizzle/019_access_codes.sql'), 'utf8'));
    for (const statement of ACCESS_CODE_SCHEMA_STATEMENTS) {
      expect(deployInit).toContain(squash(statement));
      expect(sqlFile).toContain(squash(statement));
    }
    expect(deployInit).toContain("'019_access_codes'");
  });

  it('is additive: new table and indexes only', () => {
    for (const statement of ACCESS_CODE_SCHEMA_STATEMENTS) {
      expect(statement).toMatch(/^(CREATE TABLE IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS)/);
      expect(statement).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM|UPDATE|RENAME)\b/);
    }
  });

  it('runs after the sessions table it references', () => {
    const sessions = SCHEMA_STATEMENTS.findIndex((s) => s.startsWith('CREATE TABLE IF NOT EXISTS sessions'));
    expect(sessions).toBeGreaterThan(-1);
  });
});
