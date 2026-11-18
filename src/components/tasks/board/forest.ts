import type { TaskItem } from '@/lib/task-types';

export interface Forest {
  roots: TaskItem[];
  children: Map<string, TaskItem[]>;
}

/** Build a forest from a flat task list, preserving server order. Orphans (parent not in the list) become roots. */
export function buildForest(tasks: TaskItem[]): Forest {
  const ids = new Set(tasks.map((t) => t.id));
  const children = new Map<string, TaskItem[]>();
  for (const t of tasks) {
    if (t.parent_id && ids.has(t.parent_id)) {
      const list = children.get(t.parent_id) ?? [];
      list.push(t);
      children.set(t.parent_id, list);
    }
  }
  const roots = tasks.filter((t) => !t.parent_id || !ids.has(t.parent_id));
  return { roots, children };
}

/** Stable key for sibling reordering: same parent, or same top-level category. */
export function siblingKey(task: TaskItem): string {
  return task.parent_id ? `p:${task.parent_id}` : `t:${task.topic_id ?? ''}`;
}

/** True when `maybeDescendantId` is `ancestorId` itself or nested under it. */
export function isDescendant(tasks: TaskItem[], ancestorId: string, maybeDescendantId: string): boolean {
  const parentOf = new Map(tasks.map((t) => [t.id, t.parent_id]));
  let cursor: string | null = maybeDescendantId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    if (cursor === ancestorId) return true;
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}
