/**
 * Small display helpers for the task detail page. Pure functions, no React.
 */

/** Short relative "time ago" label, or an em dash when the value is missing. */
export function relativeTime(value: string | null): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Value for a native <input type="date"> from an ISO-8601 timestamp (UTC date). */
export function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

/** ISO-8601 UTC timestamp to submit as `due_at` for a date-only input value. */
export function fromDateInputValue(value: string): string {
  return new Date(`${value}T23:59:59.000Z`).toISOString();
}
