import { describe, it, expect } from 'vitest';
import { accessCodeStatus, ACCESS_CODE_IDLE_MS, ACCESS_CODE_ABSOLUTE_MS } from '../src/lib/access-code';

describe('accessCodeStatus', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const row = (partial: Partial<{ revoked: boolean; expiresAt: Date; lastUsedAt: Date }> = {}) => ({
    revoked: false,
    expiresAt: new Date(now.getTime() + ACCESS_CODE_ABSOLUTE_MS),
    lastUsedAt: now,
    ...partial,
  });

  it('is active within both windows', () => {
    expect(accessCodeStatus(row(), now)).toBe('active');
  });

  it('revoked wins over everything', () => {
    expect(accessCodeStatus(row({ revoked: true }), now)).toBe('revoked');
  });

  it('expires at the 24h absolute cap', () => {
    expect(accessCodeStatus(row({ expiresAt: new Date(now.getTime() - 1) }), now)).toBe('expired');
  });

  it('idle-expires after 1h of inactivity', () => {
    expect(accessCodeStatus(row({ lastUsedAt: new Date(now.getTime() - ACCESS_CODE_IDLE_MS - 1) }), now)).toBe('idle_expired');
  });

  it('is still active just inside the idle window', () => {
    expect(accessCodeStatus(row({ lastUsedAt: new Date(now.getTime() - ACCESS_CODE_IDLE_MS + 1000) }), now)).toBe('active');
  });
});
