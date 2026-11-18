'use client';

import { useState } from 'react';
import { Check, ExternalLink, Link2, Unlink } from 'lucide-react';
import type { TaskSession } from '@/lib/task-types';
import { relativeTime } from './format';

const HEALTH_STYLE: Record<TaskSession['health'], string> = {
  healthy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  stale: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  drift: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

function SessionRow({ session, onUnlink, onGenerateLink, busy }: {
  session: TaskSession;
  onUnlink: (id: string) => void;
  onGenerateLink: (id: string) => void;
  busy: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copyResume() {
    try {
      await navigator.clipboard.writeText(session.resume_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is unavailable (e.g. permissions); leave the row unchanged.
    }
  }

  return (
    <tr
      className="cursor-pointer border-t border-slate-100 first:border-t-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
      onClick={copyResume}
      title="Click to copy resume code"
    >
      <td className="whitespace-nowrap px-3 py-2">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${HEALTH_STYLE[session.health]}`}>{session.health}</span>
      </td>
      <td className="max-w-[12rem] truncate px-3 py-2 text-sm text-slate-700 dark:text-slate-200" title={session.hosted_machine ?? undefined}>{session.hosted_machine || '—'}</td>
      <td className="max-w-[12rem] truncate px-3 py-2 text-sm text-slate-700 dark:text-slate-200" title={session.agent_name ?? undefined}>{session.agent_name || '—'}</td>
      <td className="max-w-[14rem] truncate px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400" title={session.id}>{session.id}</td>
      <td className="max-w-[16rem] truncate px-3 py-2 text-sm text-slate-800 dark:text-slate-200" title={session.context_title || session.title}>{session.context_title || session.title}</td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
        {copied ? (
          <span className="inline-flex flex-col items-end gap-0.5 text-emerald-700 dark:text-emerald-300">
            <span className="inline-flex items-center gap-1"><Check size={12} /> Copied resume code</span>
            {session.hosted_machine && <span className="text-[10px]">Run on {session.hosted_machine}</span>}
          </span>
        ) : (
          relativeTime(session.last_updated)
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <div className="inline-flex items-center gap-1">
          <a
            href={session.session_url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            title="View session"
            aria-label="View session"
          >
            <ExternalLink size={14} />
          </a>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onGenerateLink(session.id); }}
            disabled={busy}
            className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:text-sky-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:text-sky-300"
            title="Temporary access link"
            aria-label="Temporary access link"
          >
            <Link2 size={14} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUnlink(session.id); }}
            disabled={busy}
            className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:text-rose-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:text-rose-300"
            title="Unlink session"
            aria-label="Unlink session"
          >
            <Unlink size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

/** Sessions linked to this task, with resume-code copy, temp-link and unlink actions. */
export function SessionsTable({ sessions, onUnlink, onGenerateLink, busy }: {
  sessions: TaskSession[];
  onUnlink: (id: string) => void;
  onGenerateLink: (id: string) => void;
  busy: boolean;
}) {
  if (sessions.length === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">No sessions linked yet.</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full min-w-[52rem] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <th className="px-3 py-2 font-semibold">Health</th>
            <th className="px-3 py-2 font-semibold">Hosted machine</th>
            <th className="px-3 py-2 font-semibold">Agent</th>
            <th className="px-3 py-2 font-semibold">Session id</th>
            <th className="px-3 py-2 font-semibold">Name</th>
            <th className="px-3 py-2 font-semibold">Last updated</th>
            <th className="px-3 py-2 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => <SessionRow key={s.id} session={s} onUnlink={onUnlink} onGenerateLink={onGenerateLink} busy={busy} />)}
        </tbody>
      </table>
    </div>
  );
}
