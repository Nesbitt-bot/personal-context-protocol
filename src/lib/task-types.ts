/**
 * Wire types and pure helpers for the sprint board (migration 017). Shared by
 * the server read models and the client components so the shapes cannot drift.
 * Nothing here touches the database.
 */

export type TaskSortKey = 'category' | 'project' | 'name' | 'priority' | 'progress' | 'updated' | 'created';
export type SortDir = 'asc' | 'desc';

export const TASK_SORT_KEYS: TaskSortKey[] = ['category', 'project', 'name', 'priority', 'progress', 'updated', 'created'];

/** A repo-tag project, as shown in the board's project column and picker. */
export interface TaskProjectRef {
  id: string;
  display_name: string;
  canonical_key: string;
}

export interface TaskItem {
  id: string;
  parent_id: string | null;
  topic_id: string | null;
  topic_title: string | null;
  title: string;
  description: string | null;
  completed: boolean;
  completed_at: string | null;
  priority: number | null;
  expected_turns: number | null;
  due_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  /** Most recent session activity across this task and its subtasks. */
  last_activity_at: string | null;
  /** Primary repo-tag project, or null. */
  project: { id: string; display_name: string } | null;
  project_ids: string[];
  subtask_count: number;
  /** Sessions linked directly to this task (not its subtasks). */
  session_count: number;
  /** Sum of turns across this task and all its subtasks' sessions. */
  current_turns: number;
  /** current_turns / expected_turns, or null when expected_turns is unset. */
  progress: number | null;
}

export interface TaskCategory {
  id: string;
  title: string;
  open_count: number;
  completed_count: number;
}

export interface TaskBoard {
  id: string;
  name: string;
}

export interface BoardView {
  board: TaskBoard;
  categories: TaskCategory[];
  projects: TaskProjectRef[];
  tasks: TaskItem[];
}

export interface TaskSession {
  id: string;
  title: string;
  context_title: string | null;
  external_key: string | null;
  health: 'healthy' | 'stale' | 'drift';
  run_count: number;
  hosted_machine: string | null;
  agent_name: string | null;
  last_updated: string | null;
  project_id: string | null;
  project_name: string | null;
  /** Shell snippet to copy and run on the hosting machine to resume. */
  resume_code: string;
  session_url: string;
}

export interface TaskResource {
  id: string;
  title: string;
  url: string;
  kind: 'doc' | 'remote' | 'local';
  source: 'agent' | 'human';
  created_at: string;
}

export interface TaskDetail {
  task: TaskItem;
  categories: TaskCategory[];
  projects: TaskProjectRef[];
  sessions: TaskSession[];
  resources: TaskResource[];
}

const UNASSIGNED = '￿';

function stringKey(value: string | null): string {
  return value ?? UNASSIGNED;
}

function numericKey(value: number | null): number {
  return value ?? Number.POSITIVE_INFINITY;
}

function timeKey(value: string | null): number {
  return value ? new Date(value).getTime() : 0;
}

/**
 * Sort a flat task list by key + direction. Text/priority/progress sort
 * ascending by default; times sort descending (newest first) unless `dir` says
 * otherwise. Unassigned categories/projects and null progress sink to the end
 * in ascending order.
 */
export function sortTasks(tasks: TaskItem[], sort: TaskSortKey, dir?: SortDir): TaskItem[] {
  const direction: SortDir = dir ?? (sort === 'updated' || sort === 'created' ? 'desc' : 'asc');
  const sign = direction === 'desc' ? -1 : 1;
  const list = [...tasks];
  list.sort((a, b) => {
    let result = 0;
    switch (sort) {
      case 'category':
        result = stringKey(a.topic_title).localeCompare(stringKey(b.topic_title), undefined, { sensitivity: 'base' });
        break;
      case 'project':
        result = stringKey(a.project?.display_name ?? null).localeCompare(stringKey(b.project?.display_name ?? null), undefined, { sensitivity: 'base' });
        break;
      case 'name':
        result = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        break;
      case 'priority':
        result = numericKey(a.priority) - numericKey(b.priority);
        break;
      case 'progress':
        result = numericKey(a.progress) - numericKey(b.progress);
        break;
      case 'updated':
        result = timeKey(a.last_activity_at ?? a.updated_at) - timeKey(b.last_activity_at ?? b.updated_at);
        break;
      case 'created':
        result = timeKey(a.created_at) - timeKey(b.created_at);
        break;
    }
    if (result === 0) result = a.position - b.position;
    if (result === 0) result = a.id.localeCompare(b.id);
    return result * sign;
  });
  return list;
}

/** Percentage string for progress, or '' when there is no expected-turns target. */
export function progressLabel(item: { expected_turns: number | null; progress: number | null }): string {
  if (item.expected_turns == null || item.progress == null) return '';
  return `${Math.round(item.progress * 100)}%`;
}
