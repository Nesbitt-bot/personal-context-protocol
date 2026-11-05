import { describe, it, expect } from 'vitest';
import { decideFieldWrite, MAX_FUTURE_SKEW_MS, planMessageMerge, readClock } from '../src/lib/sync-policy';

const now = new Date('2026-11-05T12:00:00.000Z');
const at = (iso: string) => new Date(iso);
const clock = (iso: string, device: string) => ({ at: new Date(iso).toISOString(), device });

describe('sync conflict policy: last writer wins by plugin timestamp', () => {
  it('applies the first write and a newer write', () => {
    expect(decideFieldWrite('context_title', null, null, { value: 'A', at: at('2026-11-05T10:00:00Z'), device: 'win-1' }, { reviewable: true, now }).action).toBe('apply');
    const d = decideFieldWrite('project_id', 'prj_a', clock('2026-11-05T10:00:00Z', 'win-1'), { value: 'prj_b', at: at('2026-11-05T11:00:00Z'), device: 'linux-1' }, { reviewable: false, now });
    expect(d).toMatchObject({ action: 'apply', conflict: null });
  });

  it('keeps the current value against an older write', () => {
    const d = decideFieldWrite('project_id', 'prj_b', clock('2026-11-05T11:00:00Z', 'linux-1'), { value: 'prj_a', at: at('2026-11-05T10:00:00Z'), device: 'win-1' }, { reviewable: false, now });
    expect(d).toMatchObject({ action: 'keep', conflict: null });
  });

  it('records the losing version of a reviewable field edited on two machines', () => {
    const newer = decideFieldWrite('context_summary', 'from windows', clock('2026-11-05T10:00:00Z', 'win-1'), { value: 'from linux', at: at('2026-11-05T11:00:00Z'), device: 'linux-1' }, { reviewable: true, now });
    expect(newer).toMatchObject({ action: 'apply', conflict: { reason: 'concurrent_edit', kept: { value: 'from linux' }, lost: { value: 'from windows', device: 'win-1' } } });
    const stale = decideFieldWrite('context_summary', 'from linux', clock('2026-11-05T11:00:00Z', 'linux-1'), { value: 'late windows', at: at('2026-11-05T10:30:00Z'), device: 'win-1' }, { reviewable: true, now });
    expect(stale).toMatchObject({ action: 'keep', conflict: { reason: 'stale_write', kept: { value: 'from linux' }, lost: { value: 'late windows' } } });
  });

  it('is not a conflict when the writer saw the current value (fast-forward) or it is the same device', () => {
    const ff = decideFieldWrite('context_title', 'old', clock('2026-11-05T10:00:00Z', 'win-1'), { value: 'new', at: at('2026-11-05T11:00:00Z'), device: 'linux-1', base: at('2026-11-05T10:00:00Z') }, { reviewable: true, now });
    expect(ff).toMatchObject({ action: 'apply', conflict: null });
    const own = decideFieldWrite('context_title', 'v1', clock('2026-11-05T10:00:00Z', 'win-1'), { value: 'v2', at: at('2026-11-05T11:00:00Z'), device: 'win-1' }, { reviewable: true, now });
    expect(own).toMatchObject({ action: 'apply', conflict: null });
  });

  it('clamps future timestamps to the receive time and flags large skew', () => {
    const future = new Date(now.getTime() + MAX_FUTURE_SKEW_MS + 60_000);
    const d = decideFieldWrite('context_title', 'a', clock('2026-11-05T11:00:00Z', 'win-1'), { value: 'b', at: future, device: 'linux-1' }, { reviewable: true, now });
    expect(d.action).toBe('apply');
    if (d.action !== 'apply') throw new Error('unreachable');
    expect(d.clock.at).toBe(now.toISOString());
    expect(d.skewed).toBe(true);
    expect(d.conflict?.reason).toBe('clock_skew');
    // A later honest write from another machine still wins over the clamped one.
    const later = decideFieldWrite('context_title', 'b', d.clock, { value: 'c', at: new Date(now.getTime() + 1000), device: 'win-1' }, { reviewable: false, now: new Date(now.getTime() + 2000) });
    expect(later.action).toBe('apply');
  });

  it('breaks exact timestamp ties by device id, deterministically', () => {
    const t = '2026-11-05T11:00:00Z';
    const a = decideFieldWrite('context_title', 'from-a', clock(t, 'a-device'), { value: 'from-b', at: at(t), device: 'b-device' }, { reviewable: true, now });
    expect(a).toMatchObject({ action: 'apply', conflict: { reason: 'timestamp_tie' } });
    const b = decideFieldWrite('context_title', 'from-b', clock(t, 'b-device'), { value: 'from-a', at: at(t), device: 'a-device' }, { reviewable: true, now });
    expect(b).toMatchObject({ action: 'keep', conflict: { reason: 'timestamp_tie' } });
  });

  it('a same-value write advances the clock so a stale different value still loses', () => {
    const touch = decideFieldWrite('project_id', 'prj_a', clock('2026-11-05T10:00:00Z', 'win-1'), { value: 'prj_a', at: at('2026-11-05T11:00:00Z'), device: 'linux-1' }, { reviewable: false, now });
    expect(touch.action).toBe('touch');
    if (touch.action !== 'touch') throw new Error('unreachable');
    const stale = decideFieldWrite('project_id', 'prj_a', touch.clock, { value: 'prj_b', at: at('2026-11-05T10:30:00Z'), device: 'win-1' }, { reviewable: false, now });
    expect(stale.action).toBe('keep');
  });

  it('ignores malformed stored clocks', () => {
    expect(readClock({ f: { at: 'nope', device: 'x' } }, 'f')).toBeNull();
    expect(readClock(null, 'f')).toBeNull();
    expect(readClock({ f: { at: '2026-01-01T00:00:00Z', device: 'x' } }, 'f')).toEqual({ at: '2026-01-01T00:00:00Z', device: 'x' });
  });
});

describe('append-only message merge', () => {
  it('drops ids already held, de-duplicates the batch, orders by timestamp then id', () => {
    const plan = planMessageMerge(new Set(['m1']), [
      { external_id: 'm3', provider_timestamp: '2026-11-05T10:03:00Z' },
      { external_id: 'm1', provider_timestamp: '2026-11-05T10:01:00Z' },
      { external_id: 'm2', provider_timestamp: '2026-11-05T10:02:00Z' },
      { external_id: 'm2', provider_timestamp: '2026-11-05T10:02:00Z' },
      { external_id: 'm0' },
    ]);
    expect(plan.append.map((m) => m.external_id)).toEqual(['m2', 'm3', 'm0']);
    expect(plan.duplicates).toBe(2);
  });
});
