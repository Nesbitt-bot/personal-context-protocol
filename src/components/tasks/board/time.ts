/** Compact relative "time ago" label for board rows (e.g. "just now", "2h ago", "3d ago"). */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const diff = Math.max(0, Date.now() - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** `yyyy-MM-dd` value for a date input, or '' when unset. */
export function dueDateInput(iso: string | null): string {
  if (!iso) return '';
  const match = /^\d{4}-\d{2}-\d{2}/.exec(iso);
  return match ? match[0] : '';
}

/** Convert a `yyyy-MM-dd` input value into the ISO-8601 datetime the API expects. */
export function toDueIso(date: string): string {
  return `${date}T00:00:00.000Z`;
}
