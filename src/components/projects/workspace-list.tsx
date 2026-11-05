'use client';

import { Container, Laptop, Monitor, Server } from 'lucide-react';
import { openclawSuggestion, startDevSnippet } from '@/lib/dev-snippets';
import { CopyBlock } from './copy-block';
import { formatWhen, KIND_LABEL, Workspace } from './types';

const ICON: Record<string, typeof Monitor> = { windows: Monitor, linux: Server, 'linux-remote': Server, macos: Laptop, 'openclaw-container': Container };

/** Workspaces per machine with a "how to start dev here" snippet each. */
export function WorkspaceList({ workspaces, remote }: { workspaces: Workspace[]; remote: string | null }) {
  const suggestion = workspaces.some((w) => w.device_kind === 'openclaw-container') ? null : openclawSuggestion(remote);
  return (
    <div className="space-y-3">
      {workspaces.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">No workspace registered yet. Plugins register one when they see a checkout of this project.</p>}
      {workspaces.map((ws) => {
        const Icon = ICON[ws.device_kind] || Server;
        return (
          <article key={ws.id} className="rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100"><Icon size={16} /> {KIND_LABEL[ws.device_kind] || ws.device_kind}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{ws.device_label ? `${ws.device_label} · ` : ''}{ws.device_id}</span>
              {ws.default_branch && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{ws.default_branch}</span>}
              <span className="text-xs text-slate-500 dark:text-slate-400">last seen {formatWhen(ws.last_seen_at)}</span>
            </div>
            <p className="mb-2 break-all font-mono text-xs text-slate-700 dark:text-slate-300">{ws.directory}</p>
            <CopyBlock text={startDevSnippet(ws, remote).join('\n')} label={`start-dev snippet for ${ws.device_id}`} />
          </article>
        );
      })}
      {suggestion && (
        <article className="rounded-md border border-dashed border-slate-300 p-4 dark:border-slate-700">
          <p className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100"><Container size={16} /> OpenClaw container (suggested)</p>
          <p className="mb-2 break-all font-mono text-xs text-slate-700 dark:text-slate-300">{suggestion.directory}</p>
          <CopyBlock text={startDevSnippet(suggestion, remote).join('\n')} label="OpenClaw snippet" />
        </article>
      )}
    </div>
  );
}
