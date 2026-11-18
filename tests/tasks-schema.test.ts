import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { TASK_SCHEMA_STATEMENTS, SCHEMA_STATEMENTS } from '../src/lib/setup-schema';

const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

describe('migration 017 (tasks)', () => {
  it('deploy-init.js and drizzle/0017_tasks.sql carry every statement', () => {
    const deployInit = squash(fs.readFileSync(path.join(__dirname, '../scripts/deploy-init.js'), 'utf8'));
    const sqlFile = squash(fs.readFileSync(path.join(__dirname, '../drizzle/0017_tasks.sql'), 'utf8'));
    for (const statement of TASK_SCHEMA_STATEMENTS) {
      expect(deployInit).toContain(squash(statement));
      expect(sqlFile).toContain(squash(statement));
    }
    expect(deployInit).toContain("'017_tasks'");
  });

  it('is additive: new tables, nullable or defaulted columns, indexes; nothing destructive', () => {
    for (const statement of TASK_SCHEMA_STATEMENTS) {
      expect(statement).toMatch(/^(CREATE TABLE IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS|ALTER TABLE sessions ADD COLUMN IF NOT EXISTS)/);
      expect(statement).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM|UPDATE|RENAME)\b/);
    }
  });

  it('runs after the topics and projects tables it references', () => {
    const topics = SCHEMA_STATEMENTS.findIndex((s) => s.startsWith('CREATE TABLE IF NOT EXISTS topics'));
    const projects = SCHEMA_STATEMENTS.findIndex((s) => s.startsWith('CREATE TABLE IF NOT EXISTS projects'));
    const tasks = SCHEMA_STATEMENTS.findIndex((s) => s.startsWith('CREATE TABLE IF NOT EXISTS tasks'));
    expect(topics).toBeGreaterThan(-1);
    expect(projects).toBeGreaterThan(-1);
    expect(tasks).toBeGreaterThan(topics);
    expect(tasks).toBeGreaterThan(projects);
  });
});
