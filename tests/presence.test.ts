import { it, expect } from 'vitest';
import { LEASE_MS, presenceLights } from '../src/lib/presence';
const now = 100_000;
const tree = [
  { id: 'child', parentId: 'parent' },
  { id: 'parent', parentId: 'root' },
  { id: 'root', parentId: null },
];
const report = (state: string, age = 0, id = 'session') => ({
  id,
  taskId: 'child',
  state,
  seenAt: new Date(now - age),
});
it('breathes through all ancestors until the exact expiry, even without messages', () => {
  expect(presenceLights([report('synced', LEASE_MS - 1)], tree, now)).toEqual({
    sessions: { session: 'live' },
    tasks: { child: 'live', parent: 'live', root: 'live' },
  });
  expect(presenceLights([report('synced', LEASE_MS)], tree, now).tasks.root).toBe('problem');
});
it('failure wins regardless of reporter order, but clean stops and historical sessions are neutral', () => {
  for (const rows of [
    [report('synced'), report('unsynced')],
    [report('unsynced'), report('synced')],
  ]) {
    expect(presenceLights(rows, tree, now)).toEqual({
      sessions: { session: 'problem' },
      tasks: { child: 'problem', parent: 'problem', root: 'problem' },
    });
  }
  expect(presenceLights([report('closed')], tree, now)).toEqual({ sessions: {}, tasks: {} });
  expect(presenceLights([report('synced')], [], now).tasks).toEqual({});
  expect(presenceLights([report('synced')], [{ id: 'child', parentId: 'child' }], now).tasks.child).toBe(
    'live',
  );
});

it('keeps a flashing task light and red warning for a mixed subtree', () => {
  const reports = [report('synced'), { ...report('unsynced', 0, 'other'), taskId: 'sibling' }];
  for (const rows of [reports, [...reports].reverse()])
    expect(presenceLights(rows, [...tree, { id: 'sibling', parentId: 'parent' }], now).tasks).toEqual({
      child: 'live',
      sibling: 'problem',
      parent: 'mixed',
      root: 'mixed',
    });
});
