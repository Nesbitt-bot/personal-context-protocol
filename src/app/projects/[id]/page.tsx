'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, FolderGit2, GitBranch, Loader2 } from 'lucide-react';
import { SiteNav } from '@/components/site-nav';
import { readJsonResponse } from '@/lib/http';
import { diagnosticMessage, errorCause } from '@/lib/logging';
import { fetchSignedInUser, SignedInUser, uiAuthHeaders } from '@/lib/client-auth';
import { WorkspaceList } from '@/components/projects/workspace-list';
import { ConflictList } from '@/components/projects/conflict-list';
import { CopyBlock } from '@/components/projects/copy-block';
import { formatWhen, ProjectDetail } from '@/components/projects/types';

/** One project: remotes, workspaces per machine with start-dev snippets, sessions, conflicts. */
export default function ProjectPage({ params }: { params: { id: string } }) {
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/projects/${encodeURIComponent(params.id)}`, { headers: uiAuthHeaders(), cache: 'no-store' });
      const data = await readJsonResponse(res, { consequence: 'Unable to load project', moduleProcess: 'project page / detail request', fallbackCause: 'project endpoint did not return JSON' });
      if (!res.ok || data.error) { setError(data.error || 'Unable to load project: project page / detail request - request was rejected'); return; }
      setDetail(data as ProjectDetail);
    } catch (err) {
      setError(diagnosticMessage({ consequence: 'Unable to load project', moduleProcess: 'project page / detail request', cause: errorCause(err) }));
    }
  }, [params.id]);

  useEffect(() => {
    fetchSignedInUser().then((u) => {
      if (!u) { window.location.replace(`/login?next=${encodeURIComponent(`/projects/${params.id}`)}`); return; }
      setUser(u);
      load();
    });
  }, [load, params.id]);

  async function post(url: string, method: string, body: unknown, done: string, consequence: string) {
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...uiAuthHeaders() }, body: JSON.stringify(body) });
      const data = await readJsonResponse(res, { consequence, moduleProcess: 'project page / conflict review', fallbackCause: 'endpoint did not return JSON' });
      if (!res.ok || data.error) { setError(data.error || `${consequence}: project page / conflict review - request was rejected`); return; }
      setStatus(done);
      await load();
    } catch (err) {
      setError(diagnosticMessage({ consequence, moduleProcess: 'project page / conflict review', cause: errorCause(err) }));
    }
  }

  async function mergeRequest(id: string) {
    setBusy(id);
    await post(`/api/v1/conflicts/${encodeURIComponent(id)}/merge-request`, 'POST', {}, 'AI merge requested: a pending merge task now holds both versions for an agent to resolve.', 'Unable to request AI merge');
    setBusy('');
  }

  async function conflictStatus(id: string, next: 'resolved' | 'dismissed') {
    setBusy(id);
    await post(`/api/v1/conflicts/${encodeURIComponent(id)}`, 'PATCH', { status: next }, next === 'resolved' ? 'Conflict closed; the latest value stays.' : 'Conflict dismissed.', 'Unable to update conflict');
    setBusy('');
  }

  const project = detail?.project;
  const remote = project?.git_remotes[0] || null;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <SiteNav />
      <section className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline dark:text-slate-400"><ArrowLeft size={14} /> All projects</Link>
        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
        {status && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">{status}</div>}
        {!project && !error && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading project...</p>}
        {project && detail && (
          <>
            <header>
              <h1 className="flex items-center gap-2 break-words text-2xl font-semibold"><FolderGit2 size={22} className="shrink-0" /> {project.display_name}</h1>
              <p className="mt-1 break-all font-mono text-xs text-slate-500 dark:text-slate-400">{project.canonical_key}</p>
              {project.description && <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{project.description}</p>}
            </header>

            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Git remotes</h2>
              {project.git_remotes.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No remote known; this project is identified by name{project.aliases.length ? ` (aliases: ${project.aliases.join(', ')})` : ''}.</p>
              ) : (
                <ul className="space-y-2">
                  {project.git_remotes.map((r) => (
                    <li key={r} className="min-w-0">
                      <p className="mb-1 break-all text-sm text-slate-800 dark:text-slate-200">{r}</p>
                      <CopyBlock text={`git clone https://${r}.git`} label={`clone command for ${r}`} />
                    </li>
                  ))}
                </ul>
              )}
              {project.aliases.length > 0 && project.git_remotes.length > 0 && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Aliases: {project.aliases.join(', ')}</p>}
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Workspaces by machine</h2>
              <WorkspaceList workspaces={detail.workspaces} remote={remote} />
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Sessions ({detail.sessions.length})</h2>
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                {detail.sessions.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">No sessions you can see.</li>}
                {detail.sessions.map((s) => (
                  <li key={s.id} className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <GitBranch size={14} className="shrink-0 text-slate-400" />
                      <Link href={`/dashboard?session=${encodeURIComponent(s.id)}`} className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 hover:underline dark:text-slate-200">{s.context_title || s.title}</Link>
                      <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">{s.message_count} msgs · {formatWhen(s.last_message_at)}</span>
                    </div>
                    {s.context_summary && <p className="ml-7 mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-400">{s.context_summary}</p>}
                  </li>
                ))}
              </ul>
            </section>

            {user?.is_admin && (
              <section>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Sync conflicts</h2>
                <ConflictList conflicts={detail.conflicts} busy={busy} onMergeRequest={mergeRequest} onStatus={conflictStatus} />
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
