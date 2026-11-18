import type { TaskItem, TaskProjectRef } from '@/lib/task-types';

export type ViewMode = 'list' | 'category' | 'project';
export type DropZone = 'before' | 'after' | 'child';

export interface CreateProjectInput {
  name: string;
  remote?: string;
  deviceId?: string;
  deviceKind?: string;
  directory?: string;
}

export interface TaskRowProps {
  task: TaskItem;
  depth: number;
  grouped: boolean;
  collapsed: boolean;
  projects: TaskProjectRef[];
  draggedId: string | null;
  selected: boolean;
  onToggleCompleted: (task: TaskItem) => void;
  onRename: (task: TaskItem, title: string) => void;
  onSetDue: (task: TaskItem, due: string | null) => void;
  onSetPriority: (task: TaskItem, priority: number | null) => void;
  onSetProjects: (task: TaskItem, projectIds: string[], primaryId: string | null) => void;
  onCreateProject: (input: CreateProjectInput) => Promise<string | null>;
  onSelect: (task: TaskItem) => void;
  onOpen: (task: TaskItem) => void;
  onToggleCollapsed: (task: TaskItem) => void;
  onDragStart: (task: TaskItem) => void;
  onDragEnd: () => void;
  onDropOnTask: (draggedId: string, target: TaskItem, zone: DropZone) => void;
}

/** Context shared by every row in one render (task, depth, collapsed and selected vary per row). */
export type RowContext = Omit<TaskRowProps, 'task' | 'depth' | 'collapsed' | 'selected'>;
