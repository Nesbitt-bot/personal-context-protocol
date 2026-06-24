/**
 * Recording URL model.
 *
 * An external AI agent only needs two things to record a conversation:
 *
 *   1. Recording URL: https://<domain>/r/<sessionId>
 *   2. Access Token:   <raw session token, shown once>
 *
 * The recording URL carries all non-secret session information (the session id)
 * and is the entry point the agent fetches to discover upload routes. The token
 * is the only credential. These helpers are pure so URL building/parsing can be
 * unit-tested without a database or a live request.
 */

export const RECORDING_PATH_PREFIX = '/r/';

/** A usable base URL must be an absolute http(s) URL. This rejects unexpanded
 * templates like the literal `${VERCEL_URL}` mistakenly set in PCP_APP_URL. */
function isUsableBaseUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the public base URL of this deployment. Prefers `PCP_APP_URL` only when
 * it is a valid absolute http(s) URL; otherwise falls back to the per-request
 * origin (where the user actually opened the app). Returns an empty string when
 * neither is usable so callers can surface a configuration diagnostic instead of
 * emitting a broken URL. The browser UI builds recording URLs from
 * `window.location.origin` directly, so a misconfigured PCP_APP_URL never
 * reaches the copied instruction.
 */
export function resolveAppBaseUrl(requestOrigin?: string | null): string {
  const configured = (process.env.PCP_APP_URL || '').trim();
  const origin = (requestOrigin || '').trim();
  const base = isUsableBaseUrl(configured) ? configured : origin;
  return base.replace(/\/+$/, '');
}

/**
 * Build the recording URL for a session given a base URL.
 */
export function buildRecordingUrl(baseUrl: string, sessionId: string): string {
  const trimmedBase = (baseUrl || '').replace(/\/+$/, '');
  return `${trimmedBase}${RECORDING_PATH_PREFIX}${encodeURIComponent(sessionId)}`;
}

/**
 * Extract the session id from a recording URL or bare `/r/<id>` path. Returns
 * null when the value does not look like a recording URL so callers can return
 * a structured "could not resolve" error rather than guessing.
 */
export function parseRecordingUrl(value: string | null | undefined): { sessionId: string } | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let pathname = trimmed;
  try {
    // Absolute URL form: https://domain/r/<id>
    pathname = new URL(trimmed).pathname;
  } catch {
    // Not an absolute URL; treat the value as a path and continue.
  }

  const marker = pathname.indexOf(RECORDING_PATH_PREFIX);
  if (marker === -1) return null;

  const rest = pathname.slice(marker + RECORDING_PATH_PREFIX.length);
  const sessionId = decodeURIComponent(rest.split('/')[0].split('?')[0]).trim();
  if (!sessionId) return null;

  return { sessionId };
}
