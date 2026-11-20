'use client';

import { useState } from 'react';
import { GitBranch, Plus, Star, X } from 'lucide-react';
import type { TaskItem, TaskProjectRef } from '@/lib/task-types';
import type { CreateProjectInput } from './types';

const DEVICE_KINDS = ['linux', 'linux-remote', 'windows', 'macos', 'openclaw-container'] as const;

/**
 * Comma-separated project tag input. Type a name, get autocomplete matches;
 * commit with Enter/comma. Multiple projects are allowed, one marked primary.
 * A token with no match opens a "create project" form (remote repo + device +
 * working dir). Every change saves immediately so the board re-groups live.
 */
export function ProjectTagInput({ task, projects, onSave, onCreate, busy }: {
  task: TaskItem;
  projects: TaskProjectRef[];
  onSave: (projectIds: string[], primaryId: string | null) => void;
  onCreate: (input: CreateProjectInput) => Promise<string | null>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [selected, setSelected] = useState<string[]>(task.project_ids);
  const [primaryId, setPrimaryId] = useState<string | null>(task.project?.id ?? null);
  const [creating, setCreating] = useState<{ name: string } | null>(null);
  const [form, setForm] = useState({ remote: '', deviceId: '', deviceKind: 'linux', directory: '' });

  const nameOf = (id: string) => projects.find((p) => p.id === id)?.display_name ?? id;

  function openEditor() {
    setSelected([...task.project_ids]);
    setPrimaryId(task.project?.id ?? null);
    setToken('');
    setCreating(null);
    setOpen(true);
  }

  function persist(ids: string[], prim: string | null) {
    const nextPrim = prim && ids.includes(prim) ? prim : null;
    setSelected(ids);
    setPrimaryId(nextPrim);
    onSave(ids, nextPrim);
  }

  function add(id: string) {
    if (selected.includes(id)) return;
    persist([...selected, id], primaryId ?? id);
  }

  function remove(id: string) {
    persist(selected.filter((x) => x !== id), primaryId === id ? null : primaryId);
  }

  function makePrimary(id: string) {
    persist(selected, id);
  }

  function commitToken(raw: string) {
    const name = raw.trim().replace(/,+$/, '').trim();
    if (!name) return;
    const match = projects.find((p) => p.display_name.toLowerCase() === name.toLowerCase());
    if (match) {
      add(match.id);
      setToken('');
      return;
    }
    setCreating({ name });
    setToken('');
  }

  function handleChange(value: string) {
    if (value.includes(',')) {
      const parts = value.split(',');
      const last = parts.pop() ?? '';
      for (const p of parts) commitToken(p);
      setToken(last);
    } else {
      setToken(value);
    }
  }

  async function submitCreate() {
    if (!creating) return;
    const name = creating.name.trim();
    if (!name) return;
    const id = await onCreate({
      name,
      remote: form.remote.trim() || undefined,
      deviceId: form.deviceId.trim() || undefined,
      deviceKind: form.deviceKind,
      directory: form.directory.trim() || undefined,
    });
    if (id) {
      setCreating(null);
      setForm({ remote: '', deviceId: '', deviceKind: 'linux', directory: '' });
      add(id);
    }
  }

  const q = token.trim().toLowerCase();
  const exactMatch = q && projects.some((p) => p.display_name.toLowerCase() === q);
  const suggestions = projects
    .filter((p) => !selected.includes(p.id) && (!q || p.display_name.toLowerCase().includes(q)))
    .slice(0, 8);

  const label = selected.length ? selected.map(nameOf).join(', ') : 'No project';

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        className="inline-flex w-40 items-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs text-slate-500 hover:border-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:text-slate-200"
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else openEditor();
        }}
        title={label}
      >
        <GitBranch size={12} />
        <span className="truncate">{label}</span>
      </button>

      {open && (
        <>
          <button className="fixed inset-0 z-10 cursor-default" onClick={(e) => { e.stopPropagation(); setOpen(false); }} aria-label="Close project editor" tabIndex={-1} type="button" />
          <div className="absolute right-0 top-full z-20 mt-1 w-80 rounded-md border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            {selected.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {selected.map((id) => (
                  <span key={id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${id === primaryId ? 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200' : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                    {id === primaryId ? <Star size={10} className="cursor-pointer" onClick={() => makePrimary(id)} /> : <Star size={10} className="cursor-pointer text-slate-300 hover:text-sky-500" onClick={() => makePrimary(id)} />}
                    <span className="max-w-[8rem] truncate">{nameOf(id)}</span>
                    <X size={11} className="cursor-pointer hover:text-rose-500" onClick={() => remove(id)} />
                  </span>
                ))}
              </div>
            )}

            <input
              autoFocus
              value={token}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  commitToken(token);
                } else if (e.key === 'Escape') {
                  setOpen(false);
                }
              }}
              placeholder="Type project, comma to add…"
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"
              aria-label="Project tags"
            />

            {creating ? (
              <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 dark:border-slate-800">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Create project “{creating.name}”</p>
                <input value={form.remote} onChange={(e) => setForm({ ...form, remote: e.target.value })} placeholder="Git remote (optional, e.g. https://github.com/o/r.git)" className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={form.deviceId} onChange={(e) => setForm({ ...form, deviceId: e.target.value })} placeholder="Device id" className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950" />
                  <select value={form.deviceKind} onChange={(e) => setForm({ ...form, deviceKind: e.target.value })} className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900">
                    {DEVICE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <input value={form.directory} onChange={(e) => setForm({ ...form, directory: e.target.value })} placeholder="Working directory on device (optional)" className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950" />
                <div className="flex gap-2">
                  <button type="button" onClick={submitCreate} disabled={busy} className="rounded-md border border-sky-200 bg-white px-3 py-1.5 text-xs text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:border-sky-900/60 dark:bg-slate-900 dark:text-sky-300">Create & add</button>
                  <button type="button" onClick={() => setCreating(null)} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="mt-1 max-h-48 overflow-auto">
                {q && !exactMatch && (
                  <button type="button" onClick={() => { setCreating({ name: q }); setToken(''); }} className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/40">
                    <Plus size={13} /> Create “{q}”
                  </button>
                )}
                {suggestions.map((p) => (
                  <button key={p.id} type="button" onClick={() => { add(p.id); setToken(''); }} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                    <span className="truncate">{p.display_name}</span>
                    <span className="truncate text-xs text-slate-400">{p.canonical_key}</span>
                  </button>
                ))}
                {!q && suggestions.length === 0 && <p className="px-2 py-1.5 text-xs text-slate-400">No projects yet — type a name to create one.</p>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
