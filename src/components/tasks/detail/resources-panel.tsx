'use client';

import { useState, type FormEvent } from 'react';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import type { TaskResource } from '@/lib/task-types';

const KIND_LABEL: Record<TaskResource['kind'], string> = { doc: 'doc', remote: 'remote', local: 'local' };
const SOURCE_LABEL: Record<TaskResource['source'], string> = { agent: 'agent', human: 'human' };

export interface ResourceInput {
  title: string;
  url: string;
  kind?: TaskResource['kind'];
  source?: TaskResource['source'];
}

/** Bound resources: list with kind/source badges, delete, and an add form. */
export function ResourcesPanel({ resources, onAdd, onRemove, busy }: {
  resources: TaskResource[];
  onAdd: (input: ResourceInput) => Promise<boolean>;
  onRemove: (id: string) => Promise<void>;
  busy: boolean;
}) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<TaskResource['kind']>('doc');
  const [source, setSource] = useState<TaskResource['source']>('human');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedUrl = url.trim();
    if (!trimmedTitle || !trimmedUrl) return;
    const ok = await onAdd({ title: trimmedTitle, url: trimmedUrl, kind, source });
    if (ok) { setTitle(''); setUrl(''); }
  }

  return (
    <div className="space-y-3">
      {resources.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No resources bound yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {resources.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <a href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 truncate text-sm font-medium text-sky-700 hover:underline dark:text-sky-300" title={r.url}>
                  <ExternalLink size={13} className="shrink-0" /> {r.title}
                </a>
                <div className="mt-0.5 flex gap-1.5">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{KIND_LABEL[r.kind]}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{SOURCE_LABEL[r.source]}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(r.id)}
                disabled={busy}
                className="rounded-md border border-slate-200 p-1.5 text-slate-400 hover:text-rose-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:text-rose-300"
                title="Remove resource"
                aria-label="Remove resource"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Title</span>
          <input className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Design doc" />
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">URL</span>
          <input className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Kind</span>
          <select className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900" value={kind} onChange={(e) => setKind(e.target.value as TaskResource['kind'])}>
            <option value="doc">doc</option>
            <option value="remote">remote</option>
            <option value="local">local</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Source</span>
          <select className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900" value={source} onChange={(e) => setSource(e.target.value as TaskResource['source'])}>
            <option value="human">human</option>
            <option value="agent">agent</option>
          </select>
        </label>
        <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
          <Plus size={14} /> Add resource
        </button>
      </form>
    </div>
  );
}
