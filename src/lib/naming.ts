/**
 * Title and slug generation for human-facing topics and sessions.
 *
 * These helpers are pure so they can be unit-tested without a database. Route
 * handlers fetch the existing titles/slugs, then call into here. The goal is
 * that a human can click "New Topic" or "New Session" without pausing to name
 * anything, and that duplicate names are auto-suffixed instead of rejected.
 */

export const DEFAULT_TOPIC_TITLE = 'New Topic';
export const DEFAULT_SESSION_TITLE = 'New Session';

const CONTROL_CHAR_MAX = 0x1f;
const DEL_CHAR = 0x7f;

/**
 * Collapse a free-text title into a stored display title: drop control
 * characters, collapse internal whitespace runs to single spaces, and trim.
 */
export function normalizeTitle(input: string | null | undefined): string {
  if (!input) return '';
  let cleaned = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    cleaned += code <= CONTROL_CHAR_MAX || code === DEL_CHAR ? ' ' : ch;
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Build a URL-safe slug from a title. Lowercased, non-alphanumeric runs become
 * single hyphens, leading/trailing hyphens removed.
 */
export function slugify(input: string | null | undefined): string {
  return (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Return a display title that does not collide with `existing` (case-insensitive
 * on the normalized form). The first collision becomes "<base> 2", then
 * "<base> 3", and so on. `base` is normalized first; if it is empty, `fallback`
 * is used so the caller always gets a usable default.
 */
export function generateUniqueTitle(
  base: string | null | undefined,
  existing: Array<string | null | undefined>,
  fallback = DEFAULT_TOPIC_TITLE,
): string {
  const normalizedBase = normalizeTitle(base) || normalizeTitle(fallback) || fallback;
  const taken = new Set(existing.map((title) => normalizeTitle(title).toLowerCase()));

  if (!taken.has(normalizedBase.toLowerCase())) {
    return normalizedBase;
  }

  let suffix = 2;
  while (taken.has(`${normalizedBase} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${normalizedBase} ${suffix}`;
}

/**
 * Return a slug that does not collide with `existing`. The first collision
 * becomes "<base>-2", then "<base>-3". Empty slugs fall back to `fallback`.
 */
export function generateUniqueSlug(
  base: string | null | undefined,
  existing: Array<string | null | undefined>,
  fallback = 'topic',
): string {
  const baseSlug = slugify(base) || slugify(fallback) || 'topic';
  const taken = new Set(existing.map((slug) => slugify(slug)));

  if (!taken.has(baseSlug)) {
    return baseSlug;
  }

  let suffix = 2;
  while (taken.has(`${baseSlug}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseSlug}-${suffix}`;
}
