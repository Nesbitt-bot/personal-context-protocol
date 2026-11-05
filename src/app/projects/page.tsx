'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronRight, FolderGit2, GitBranch, Loader2, MessageSquare } from 'lucide-react';
import { SiteNav } from '@/components/site-nav';
import { readJsonResponse } from '@/lib/http';
import { diagnosticMessage, errorCause } from '@/lib/logging';
import { fetchSignedInUser, uiAuthHeaders } from '@/lib/client-auth';
import { formatWhen, KIND_LABEL, ProjectDetail, ProjectSummary } from '@/components/projects/types';

/** Projects across machines, each expandable to its sessions (grouped by project). */
export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [unassigned, setUnassigned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, ProjectDetail | 'loading'>>({});

  useEffect(() => {
    (async () => {
      const user = await fetchSignedInUser();
      if (!user) { window.location.replace('/login?next=/projects'); return; }
      try {
        const res = await fetch('/api/v1/projects', { headers: uiAuthHeaders(), cache: 'no-store' });
        const data = await readJsonResponse(res, { consequence: 'Unable to load projects', moduleProcess: 'projects page / list request', fallbackCause: 'projects endpoint did not return JSON' });
        if (!res.ok || data.error) { setError(data.error || 'Unable to load projects: projects page / list request - request was rejected'); return; }
        setProjects(data.projects || []);
        setUnassigned(Number(data.unassigned_sessions || 0));
      } catch (err) {
        setError(diagnosticMessage({ consequence: 'Unable to load projects', moduleProcess: 'projects page / list request', cause: `browser could not reach /api/v1/projects; ${errorCause(err)}` }));
      } finally { setLoading(false); }
    })();
  }, []);

  async function toggle(id: string) {
    if (open[id]) { setOpen((prev) => { const next = { ...prev }; delete next[id]; return next; }); return; }
    setOpen((prev) => ({ ...prev, [id]: 'loading' }));
    try {
      const res = await fetch(`/api/v1/projects/${encodeURIComponent(id)}`, { headers: uiAuthHeaders(), cache: 'no-store' });
      const data = await readJsonResponse(res, { consequence: 'Unable to load project sessions', moduleProcess: 'projects page / project detail request', fallbackCause: 'project endpoint did not return JSON' });
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setOpen((prev) => ({ ...prev, [id]: data as ProjectDetail }));
    } catch (err) {
      setOpen((prev) => { const next = { ...prev }; delete next[id]; return next; });
      setError(diagnosticMessage({ consequence: 'Unable to load project sessions', moduleProcess: 'projects page / project detail request', cause: errorCause(err) }));
    }
  }

  const q = query.trim().toLowerCase();
  const shown = q ? projects.filter((p) => `${p.display_name} ${p.canonical_key} ${p.git_remotes.join(' ')}`.toLowerCase().includes(q)) : projects;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <SiteNav />
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold"><FolderGit2 size={22} /> Projects</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">One project per repository across every machine. Sessions hold the per-task context inside a project.</p>
          </div>
          <input
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900 sm:w-64"
            placeholder="Filter projects"
            aria-label="Filter projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading projects...</p>
        ) : (
          <div className="space-y-2">
            {shown.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">No projects yet.</p>}
            {shown.map((p) => {
              const detail = open[p.id];
              return (
                <article key={p.id} className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center gap-2 p-3">
                    <button className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => toggle(p.id)} type="button" aria-expanded={Boolean(detail)} aria-label={`Show sessions of ${p.display_name}`}>
                      <ChevronRight size={16} className={`transition-transform ${detail ? 'rotate-90' : ''}`} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <Link href={`/projects/${encodeURIComponent(p.id)}`} className="font-medium text-slate-900 hover:underline dark:text-slate-100">{p.display_name}</Link>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{p.git_remotes[0] || p.canonical_key}</p>
                    </div>
                    <div className="hidden shrink-0 flex-wrap justify-end gap-1 sm:flex">
                      {p.device_kinds.map((k) => <span key={k} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{KIND_LABEL[k] || k}</span>)}
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><MessageSquare size={13} /> {p.session_count}</span>
                  </div>
                  {detail === 'loading' && <p className="border-t border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-800">Loading sessions...</p>}
                  {detail && detail !== 'loading' && (
                    <ul className="divide-y divide-slate-100 border-t border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                      {detail.sessions.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">No sessions you can see.</li>}
                      {detail.sessions.map((s) => (
                        <li key={s.id} className="flex items-center gap-3 px-4 py-2">
                          <GitBranch size={14} className="shrink-0 text-slate-400" />
                          <Link href={`/dashboard?session=${encodeURIComponent(s.id)}`} className="min-w-0 flex-1 truncate text-sm text-slate-800 hover:underline dark:text-slate-200">{s.context_title || s.title}</Link>
                          <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">{s.message_count} msgs · {formatWhen(s.last_message_at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
            {unassigned > 0 && (
              <p className="pt-2 text-sm text-slate-500 dark:text-slate-400">
                {unassigned} session{unassigned === 1 ? '' : 's'} not in any project. <Link className="underline" href="/dashboard">Open sessions</Link>
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
