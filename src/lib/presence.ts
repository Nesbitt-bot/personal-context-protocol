export const LEASE_MS = 65_000; // Three missed 20-second plugin heartbeats, plus jitter.
export type Light = 'live' | 'problem' | 'mixed';
export type Lights = { sessions: Record<string, Light>; tasks: Record<string, Light> };
type Report = { id: string; taskId: string | null; state: string; seenAt: Date };

/** No reports or a clean close means neutral, not a failed historical import. */
export function presenceLights(
  reports: Report[],
  parents: { id: string; parentId: string | null }[],
  now: number,
): Lights {
  const result: Lights = { sessions: {}, tasks: {} };
  const parent = new Map(parents.map((t) => [t.id, t.parentId]));
  const linked = new Map<string, string>();
  for (const row of reports) {
    if (row.state === 'closed') continue;
    const light = row.state === 'synced' && now - row.seenAt.getTime() < LEASE_MS ? 'live' : 'problem';
    if (result.sessions[row.id] !== 'problem') result.sessions[row.id] = light;
    if (row.taskId) linked.set(row.id, row.taskId);
  }
  // Merge at most twice per task. A red sibling must not hide activity in a
  // healthy branch, including when a parent is collapsed. Also cycle-safe.
  for (const [id, taskId] of linked) {
    const light = result.sessions[id];
    let task: string | null = taskId;
    while (task && parent.has(task)) {
      const prev: Light | undefined = result.tasks[task];
      if (prev === light || prev === 'mixed') break;
      result.tasks[task] = prev ? 'mixed' : light;
      task = parent.get(task) ?? null;
    }
  }
  return result;
}
