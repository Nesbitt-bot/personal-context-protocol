'use client';

import { Bot, Check, X } from 'lucide-react';
import { Conflict, formatWhen } from './types';

function show(value: unknown) {
  if (value === null || value === undefined) return '(empty)';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Open sync conflicts with review actions (admin only). */
export function ConflictList({ conflicts, busy, onMergeRequest, onStatus }: {
  conflicts: Conflict[];
  busy: string;
  onMergeRequest: (id: string) => void;
  onStatus: (id: string, status: 'resolved' | 'dismissed') => void;
}) {
  if (conflicts.length === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">No open sync conflicts.</p>;
  return (
    <div className="space-y-3">
      {conflicts.map((c) => (
        <article key={c.id} className="rounded-md border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
          <p className="mb-2 text-sm font-medium text-amber-900 dark:text-amber-200">{c.entity_type} · {c.field} · {c.reason.replace(/_/g, ' ')}</p>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="min-w-0 rounded-md border border-emerald-200 bg-white p-2 text-xs dark:border-emerald-900/60 dark:bg-slate-950">
              <p className="mb-1 font-semibold text-emerald-700 dark:text-emerald-300">Kept (latest) · {c.kept.device} · {formatWhen(c.kept.at)}</p>
              <p className="whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200">{show(c.kept.value)}</p>
            </div>
            <div className="min-w-0 rounded-md border border-slate-200 bg-white p-2 text-xs dark:border-slate-800 dark:bg-slate-950">
              <p className="mb-1 font-semibold text-slate-600 dark:text-slate-300">Superseded · {c.lost.device} · {formatWhen(c.lost.at)}</p>
              <p className="whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200">{show(c.lost.value)}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-white px-3 py-1.5 text-xs text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-900/60 dark:bg-slate-900 dark:text-violet-300" disabled={busy === c.id} onClick={() => onMergeRequest(c.id)} type="button">
              <Bot size={14} /> Request AI merge
            </button>
            <button className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-900/60 dark:bg-slate-900 dark:text-emerald-300" disabled={busy === c.id} onClick={() => onStatus(c.id, 'resolved')} type="button">
              <Check size={14} /> Keep latest
            </button>
            <button className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300" disabled={busy === c.id} onClick={() => onStatus(c.id, 'dismissed')} type="button">
              <X size={14} /> Dismiss
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
