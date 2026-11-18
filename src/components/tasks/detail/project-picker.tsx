'use client';

import { useState } from 'react';
import { Pencil, Star } from 'lucide-react';
import type { TaskItem, TaskProjectRef } from '@/lib/task-types';

/** Project chips with an edit control to change the bound set and primary. */
export function ProjectPicker({ task, projects, onSave, busy }: {
  task: TaskItem;
  projects: TaskProjectRef[];
  onSave: (projectIds: string[], primaryId: string | null) => Promise<boolean>;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);

  function start() {
    setSelected([...task.project_ids]);
    setPrimaryId(task.project?.id ?? null);
    setEditing(true);
  }

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setPrimaryId((prev) => (prev === id ? null : prev));
  }

  async function save() {
    const primary = primaryId && selected.includes(primaryId) ? primaryId : null;
    const ok = await onSave(selected, primary);
    if (ok) setEditing(false);
  }

  const nameOf = (id: string) => projects.find((p) => p.id === id)?.display_name ?? id;

  if (editing) {
    return (
      <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <div className="mb-3 grid gap-1.5 sm:grid-cols-2">
          {projects.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" className="accent-sky-600" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
              {p.display_name}
            </label>
          ))}
        </div>
        {projects.length === 0 && <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">No projects defined yet.</p>}
        <label className="mb-3 flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Primary project</span>
          <select className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900" value={primaryId ?? ''} onChange={(e) => setPrimaryId(e.target.value || null)}>
            <option value="">None</option>
            {projects.filter((p) => selected.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={save} disabled={busy} className="rounded-md border border-sky-200 bg-white px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:border-sky-900/60 dark:bg-slate-900 dark:text-sky-300">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {task.project_ids.length === 0 && <span className="text-sm text-slate-500 dark:text-slate-400">No projects</span>}
      {task.project_ids.map((id) => {
        const isPrimary = id === task.project?.id;
        return (
          <span key={id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${isPrimary ? 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200' : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
            {isPrimary && <Star size={11} />} {nameOf(id)}
          </span>
        );
      })}
      <button type="button" onClick={start} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
        <Pencil size={12} /> Edit
      </button>
    </div>
  );
}
