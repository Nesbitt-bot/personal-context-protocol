/**
 * External session keys.
 *
 * A sync worker (for example the OpenCode session-manager plugin) owns
 * transcripts that already have a stable identity on the device that recorded
 * them. That identity is sent as an `external_key` so repeated pushes resolve
 * to the same PCP session instead of creating duplicates:
 *
 *   <device-id>:<source-kind>:<native-session-id>
 *
 * PCP treats the key as opaque beyond these bounds — it never parses it to make
 * authorization decisions — but it is validated so an unbounded or empty string
 * cannot become a session identity.
 */

export const MAX_EXTERNAL_KEY_CHARS = 200;

/**
 * Normalize a caller-supplied external key.
 *
 * Returns `null` when the field was absent, and throws when it was present but
 * unusable, so a typo surfaces as a validation error rather than silently
 * creating a duplicate session on every retry.
 */
export function normalizeExternalKey(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new Error('external_key must be a string');
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('external_key must not be empty');
  }
  if (trimmed.length > MAX_EXTERNAL_KEY_CHARS) {
    throw new Error(`external_key must be at most ${MAX_EXTERNAL_KEY_CHARS} characters`);
  }
  // Control characters would make the key unloggable and unsafe to echo back.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error('external_key must not contain control characters');
  }

  return trimmed;
}
