'use client';

import { useState, type FormEvent } from 'react';
import { Link2 } from 'lucide-react';

/** Associate an existing session with this task by session id. */
export function LinkSessionPanel({ onLink, busy }: {
  onLink: (sessionId: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [value, setValue] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = value.trim();
    if (!id) return;
    const ok = await onLink(id);
    if (ok) setValue('');
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-xs text-slate-500 dark:text-slate-400">Session id</span>
        <input
          className="rounded-md border border-slate-200 bg-white px-2 py-1.5 font-mono text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. sess_…"
        />
      </label>
      <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
        <Link2 size={14} /> Link
      </button>
    </form>
  );
}
