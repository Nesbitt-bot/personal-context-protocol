'use client';

import { useState } from 'react';
import { LayoutGrid, List, ListTodo, Pencil, Plus } from 'lucide-react';
import { TASK_SORT_KEYS, type SortDir, type TaskSortKey } from '@/lib/task-types';
import type { ViewMode } from './types';

const SORT_LABEL: Record<TaskSortKey, string> = {
  category: 'Category',
  project: 'Project',
  name: 'Name',
  priority: 'Priority',
  progress: 'Progress',
  updated: 'Last updated',
  created: 'Created',
};

const VIEWS: { key: ViewMode; label: string; icon: typeof List }[] = [
  { key: 'list', label: 'List', icon: List },
  { key: 'category', label: 'Category', icon: ListTodo },
  { key: 'project', label: 'Project', icon: LayoutGrid },
];

const BTN = 'inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800';
const BTN_ACTIVE = 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100';

/** Board heading (inline-editable name), create buttons, view switcher and sort controls. */
export function BoardToolbar(props: {
  boardName: string;
  view: ViewMode;
  sort: TaskSortKey;
  dir: SortDir;
  onRenameBoard: (name: string) => void;
  onAddCategory: () => void;
  onAddTask: () => void;
  onViewChange: (view: ViewMode) => void;
  onSortChange: (sort: TaskSortKey, dir: SortDir) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(props.boardName);

  function commitName() {
    setEditingName(false);
    const next = nameDraft.trim();
    if (next && next !== props.boardName) props.onRenameBoard(next);
  }

  return (
    <div className="mb-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              else if (e.key === 'Escape') setEditingName(false);
            }}
            className="rounded-md border border-sky-400 bg-white px-2 py-1 text-2xl font-semibold outline-none dark:bg-slate-950"
            aria-label="Board name"
          />
        ) : (
          <button
            className="group inline-flex items-center gap-2 text-2xl font-semibold text-slate-950 hover:text-sky-600 dark:text-slate-50 dark:hover:text-sky-300"
            onClick={() => {
              setNameDraft(props.boardName);
              setEditingName(true);
            }}
            type="button"
          >
            {props.boardName}
            <Pencil size={16} className="text-slate-400 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button className={BTN} onClick={props.onAddCategory} type="button">
            <Plus size={14} /> Add category
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
            onClick={props.onAddTask}
            type="button"
          >
            <Plus size={14} /> Add task
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 rounded-md border border-slate-200 p-1 dark:border-slate-700">
          {VIEWS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${props.view === key ? BTN_ACTIVE : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              onClick={() => props.onViewChange(key)}
              type="button"
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900"
            value={props.sort}
            onChange={(e) => props.onSortChange(e.target.value as TaskSortKey, props.dir)}
            aria-label="Sort by"
          >
            {TASK_SORT_KEYS.map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900"
            value={props.dir}
            onChange={(e) => props.onSortChange(props.sort, e.target.value as SortDir)}
            aria-label="Sort direction"
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </div>
      </div>
    </div>
  );
}
