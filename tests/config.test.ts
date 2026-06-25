import { describe, it, expect } from 'vitest';
import { validateRuntimeConfig } from '../src/lib/config';

const GOOD = {
  DATABASE_URL: 'postgresql://user:pass@host:5432/db?sslmode=require',
  PCP_INSTANCE_SECRET: 'a'.repeat(32),
  PCP_APP_URL: 'https://pcp.example.com',
};

function keys(env: Record<string, string | undefined>) {
  return validateRuntimeConfig(env).issues.map((i) => `${i.key}:${i.severity}`);
}

describe('validateRuntimeConfig', () => {
  it('passes for a valid configuration', () => {
    const result = validateRuntimeConfig(GOOD);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags a missing DATABASE_URL as an error', () => {
    const result = validateRuntimeConfig({ ...GOOD, DATABASE_URL: '' });
    expect(result.ok).toBe(false);
    expect(keys({ ...GOOD, DATABASE_URL: '' })).toContain('DATABASE_URL:error');
  });

  it('flags a malformed DATABASE_URL (not just missing)', () => {
    const result = validateRuntimeConfig({ ...GOOD, DATABASE_URL: 'mysql://host/db' });
    expect(result.ok).toBe(false);
  });

  it('flags a too-short instance secret', () => {
    const result = validateRuntimeConfig({ ...GOOD, PCP_INSTANCE_SECRET: 'short' });
    expect(result.ok).toBe(false);
    expect(keys({ ...GOOD, PCP_INSTANCE_SECRET: 'short' })).toContain('PCP_INSTANCE_SECRET:error');
  });

  it('treats a missing PCP_APP_URL as a warning, not an error', () => {
    const result = validateRuntimeConfig({ ...GOOD, PCP_APP_URL: '' });
    expect(result.ok).toBe(true);
    expect(keys({ ...GOOD, PCP_APP_URL: '' })).toContain('PCP_APP_URL:warning');
  });

  it('flags an unexpanded ${VERCEL_URL} template as a malformed PCP_APP_URL error', () => {
    const result = validateRuntimeConfig({ ...GOOD, PCP_APP_URL: '${VERCEL_URL}' });
    expect(result.ok).toBe(false);
    expect(keys({ ...GOOD, PCP_APP_URL: '${VERCEL_URL}' })).toContain('PCP_APP_URL:error');
  });

  it('never includes the value in an issue', () => {
    const result = validateRuntimeConfig({ ...GOOD, PCP_INSTANCE_SECRET: 'super-secret-value-1234' });
    expect(JSON.stringify(result.issues)).not.toContain('super-secret-value');
  });
});
