/**
 * Conflict policy for fields synced from several machines (see
 * docs/protocol.md "Sync conflict policy"). Pure and deterministic.
 *
 * Every write carries the plugin's own `updated_at` and `device_id`, and may
 * carry `base_updated_at`: the field clock the writer last saw.
 *
 * - Last writer wins by plugin timestamp. A timestamp in the future is
 *   clamped to the server's receive time, so one machine with a fast clock
 *   cannot win every later edit; beyond MAX_FUTURE_SKEW_MS it is also flagged.
 * - Equal timestamps: the lexically greater device id wins (stable on every
 *   replica).
 * - Reviewable fields (titles, summaries, descriptions): when the losing value
 *   came from another device and the winner had not seen it (no matching
 *   `base_updated_at`), the losing value is recorded as a conflict for review
 *   instead of disappearing. A device editing its own value, or a writer that
 *   fast-forwards from the current clock, is not a conflict.
 * - A same-value write only advances the clock, so a later stale write with a
 *   different value still loses.
 */

export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export interface FieldClock {
  at: string;
  device: string;
}

export type ClockMap = Record<string, FieldClock>;

export interface FieldWrite {
  value: unknown;
  at: Date;
  device: string;
  base?: Date | null;
}

export type ConflictReason = 'concurrent_edit' | 'stale_write' | 'timestamp_tie' | 'clock_skew';

export interface ConflictRecord {
  field: string;
  reason: ConflictReason;
  kept: { value: unknown; at: string; device: string };
  lost: { value: unknown; at: string; device: string };
}

export type Decision =
  | { action: 'apply'; clock: FieldClock; skewed: boolean; conflict: ConflictRecord | null }
  | { action: 'touch'; clock: FieldClock; skewed: boolean }
  | { action: 'keep'; skewed: boolean; conflict: ConflictRecord | null };

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function readClock(map: unknown, field: string): FieldClock | null {
  if (!map || typeof map !== 'object') return null;
  const entry = (map as Record<string, unknown>)[field];
  if (!entry || typeof entry !== 'object') return null;
  const { at, device } = entry as Record<string, unknown>;
  if (typeof at !== 'string' || typeof device !== 'string' || Number.isNaN(Date.parse(at))) return null;
  return { at, device };
}

export function decideFieldWrite(
  field: string,
  currentValue: unknown,
  currentClock: FieldClock | null,
  write: FieldWrite,
  options: { reviewable: boolean; now?: Date },
): Decision {
  const now = options.now ?? new Date();
  const skewed = write.at.getTime() - now.getTime() > MAX_FUTURE_SKEW_MS;
  const effective = new Date(Math.min(write.at.getTime(), now.getTime()));
  const clock: FieldClock = { at: effective.toISOString(), device: write.device };

  if (!currentClock) {
    return sameValue(currentValue, write.value) ? { action: 'touch', clock, skewed } : { action: 'apply', clock, skewed, conflict: null };
  }

  const currentAt = Date.parse(currentClock.at);
  const incomingAt = effective.getTime();
  const newer = incomingAt > currentAt || (incomingAt === currentAt && write.device > currentClock.device);
  const tie = incomingAt === currentAt && write.device !== currentClock.device;

  if (sameValue(currentValue, write.value)) {
    return newer ? { action: 'touch', clock, skewed } : { action: 'keep', skewed, conflict: null };
  }

  const otherDevice = write.device !== currentClock.device;
  const sawCurrent = Boolean(write.base) && write.base!.getTime() === currentAt;
  const incomingRecord = { value: write.value, at: clock.at, device: write.device };
  const currentRecord = { value: currentValue, at: currentClock.at, device: currentClock.device };
  const reason = (fallback: ConflictReason): ConflictReason => (skewed ? 'clock_skew' : tie ? 'timestamp_tie' : fallback);

  if (newer) {
    const conflict = options.reviewable && otherDevice && !sawCurrent
      ? { field, reason: reason('concurrent_edit'), kept: incomingRecord, lost: currentRecord }
      : null;
    return { action: 'apply', clock, skewed, conflict };
  }
  const conflict = options.reviewable && otherDevice
    ? { field, reason: reason('stale_write'), kept: currentRecord, lost: incomingRecord }
    : null;
  return { action: 'keep', skewed, conflict };
}

export interface IncomingMessage {
  external_id: string;
  provider_timestamp?: string | null;
}

/**
 * Append-only merge for message streams from several machines: drop messages
 * whose id PCP already holds, order the rest by (timestamp, id) and append
 * them after the existing ordinals. Existing messages are never rewritten or
 * reordered; readers that want a chronological view sort by
 * (provider_timestamp, ordinal).
 */
export function planMessageMerge<T extends IncomingMessage>(existingIds: ReadonlySet<string>, incoming: readonly T[]): { append: T[]; duplicates: number } {
  const seen = new Set(existingIds);
  const fresh: T[] = [];
  let duplicates = 0;
  for (const message of incoming) {
    if (seen.has(message.external_id)) { duplicates += 1; continue; }
    seen.add(message.external_id);
    fresh.push(message);
  }
  const time = (m: T) => (m.provider_timestamp ? Date.parse(m.provider_timestamp) : Number.POSITIVE_INFINITY);
  fresh.sort((a, b) => time(a) - time(b) || (a.external_id < b.external_id ? -1 : a.external_id > b.external_id ? 1 : 0));
  return { append: fresh, duplicates };
}
