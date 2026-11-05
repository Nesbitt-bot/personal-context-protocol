/**
 * Only same-origin absolute paths are accepted as post-login destinations, so
 * the login flow cannot be turned into an open redirect. Pure, so the login
 * page (break-glass path) and the OIDC server flow share one rule: browsers
 * treat a backslash as a slash, so `/\\evil.example` would otherwise leave
 * the site.
 */
export const DEFAULT_RETURN_TO = '/dashboard';

export function sanitizeReturnTo(value: string | null | undefined): string {
  const fallback = DEFAULT_RETURN_TO;
  if (!value || typeof value !== 'string' || value.length > 512) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (value.startsWith('/auth/') || value.startsWith('/api/')) return fallback;
  return value;
}
