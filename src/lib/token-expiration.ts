/**
 * Session access token expiration.
 *
 * Tokens may be created with a fixed lifetime or set to never expire. A null
 * `expires_at` means "never expire" — which is also how pre-existing tokens
 * (created before expiration was offered) are treated after migration. Pure
 * helpers so the choices and status logic can be unit-tested without a clock
 * dependency (callers pass `now`).
 */

export const EXPIRATION_CHOICES = ['1h', '24h', '7d', '30d', 'never'] as const;
export type ExpirationChoice = (typeof EXPIRATION_CHOICES)[number];

export const DEFAULT_EXPIRATION: ExpirationChoice = '7d';

const DURATION_MS: Record<Exclude<ExpirationChoice, 'never'>, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export function isExpirationChoice(value: unknown): value is ExpirationChoice {
  return typeof value === 'string' && (EXPIRATION_CHOICES as readonly string[]).includes(value);
}

/**
 * Resolve an expiration choice to an absolute `expires_at` timestamp, or null
 * for "never expire". `now` is injected so the result is deterministic in tests.
 */
export function resolveExpiresAt(choice: ExpirationChoice, now: Date): Date | null {
  if (choice === 'never') return null;
  return new Date(now.getTime() + DURATION_MS[choice]);
}

export type TokenStatus = 'active' | 'expired' | 'revoked';

/**
 * Derive the display status of a token. Revocation takes precedence over
 * expiration. A null `expiresAt` never expires.
 */
export function tokenStatus(
  token: { revoked: boolean; expiresAt: Date | string | null },
  now: Date,
): TokenStatus {
  if (token.revoked) return 'revoked';
  if (token.expiresAt) {
    const expires = token.expiresAt instanceof Date ? token.expiresAt : new Date(token.expiresAt);
    if (expires.getTime() <= now.getTime()) return 'expired';
  }
  return 'active';
}
