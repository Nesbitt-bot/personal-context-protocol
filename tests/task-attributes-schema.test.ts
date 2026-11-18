import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { TASK_ATTR_SCHEMA_STATEMENTS, SCHEMA_STATEMENTS } from '../src/lib/setup-schema';

const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

describe('migration 018 (task attributes)', () => {
  it('deploy-init.js and drizzle/0018_task_attributes.sql carry every statement', () => {
    const deployInit = squash(fs.readFileSync(path.join(__dirname, '../scripts/deploy-init.js'), 'utf8'));
    const sqlFile = squash(fs.readFileSync(path.join(__dirname, '../drizzle/0018_task_attributes.sql'), 'utf8'));
    for (const statement of TASK_ATTR_SCHEMA_STATEMENTS) {
      expect(deployInit).toContain(squash(statement));
      expect(sqlFile).toContain(squash(statement));
    }
    expect(deployInit).toContain("'018_task_attributes'");
  });

  it('is additive: new nullable columns and indexes only', () => {
    for (const statement of TASK_ATTR_SCHEMA_STATEMENTS) {
      expect(statement).toMatch(/^(ALTER TABLE (sessions|tasks) ADD COLUMN IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS)/);
      expect(statement).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM|UPDATE|RENAME)\b/);
    }
  });

  it('runs after the tables it alters', () => {
    const sessions = SCHEMA_STATEMENTS.findIndex((s) => s.startsWith('CREATE TABLE IF NOT EXISTS sessions'));
    const tasks = SCHEMA_STATEMENTS.findIndex((s) => s.startsWith('CREATE TABLE IF NOT EXISTS tasks'));
    expect(sessions).toBeGreaterThan(-1);
    expect(tasks).toBeGreaterThan(-1);
  });
});
