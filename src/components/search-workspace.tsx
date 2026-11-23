'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { uiAuthHeaders } from '@/lib/client-auth';
import { keywordPattern, scopeLabels, searchScopes, type SearchHit, type SearchMode, type SearchResults, type SearchScope } from '@/lib/search-options';
import { searchUrl, SessionSearch } from './session-search';

function Highlight({ text, pattern }: { text: string; pattern: RegExp }) {
  return <>{text.split(pattern).map((part, i) => i % 2
    ? <mark key={i} className="rounded-sm bg-amber-200 text-slate-950 dark:bg-amber-300">{part}</mark> : part)}</>;
}

function ResultSection({ section, hits, pattern }: { section: Exclude<SearchScope, 'all'>; hits: SearchHit[]; pattern: RegExp }) {
  return <section aria-label={scopeLabels[section]} className="rounded-lg border bg-white dark:border-slate-700 dark:bg-slate-900">
    <h2 className="border-b px-4 py-3 font-semibold dark:border-slate-700">{scopeLabels[section]} <span className="text-xs font-normal text-slate-500">{hits.length} shown</span></h2>
    {hits.length === 0 ? <p className="p-4 text-sm text-slate-500">No matches.</p> : <ul className="divide-y dark:divide-slate-700">
      {hits.map(hit => <li key={hit.id} className="break-words px-4 py-3">
        <Link className="font-medium text-sky-700 hover:underline dark:text-sky-300" href={section === 'sessions'
          ? `/dashboard?session=${encodeURIComponent(hit.id)}` : `/${section}/${encodeURIComponent(hit.id)}`}>
          <Highlight text={hit.title} pattern={pattern} />
        </Link>
        {hit.snippet && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300"><Highlight text={hit.snippet} pattern={pattern} /></p>}
      </li>)}
    </ul>}
  </section>;
}

export function SearchWorkspace({ q, scope, mode }: { q: string; scope: SearchScope; mode: SearchMode }) {
  const [data, setData] = useState<SearchResults | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const valid = q.length > 0 && q.length <= 500;
  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/v1/search', { method: 'POST', cache: 'no-store', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...uiAuthHeaders() }, body: JSON.stringify({ q, scope, mode }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Unable to load search results.');
        if (!controller.signal.aborted) setData(body);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load search results.');
      }
    }
    void load();
    return () => controller.abort();
  }, [q, scope, mode, valid, retry]);
  const pattern = (indexedWords = false) => new RegExp(`(${valid ? keywordPattern(q, indexedWords) : '(?!)'})`, 'iu');
  const linkClass = (active: boolean) => `block rounded-md px-3 py-2 text-sm ${active ? 'bg-sky-100 font-semibold text-sky-900 dark:bg-sky-950 dark:text-sky-200' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`;
  return <div className="mx-auto max-w-6xl space-y-5 px-4 py-8 sm:px-6">
    <h1 className="text-2xl font-semibold">Search PCP</h1>
    <SessionSearch query={q} scope={scope} mode={mode} />
    <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="space-y-4">
        <nav aria-label="Search scope"><h2 className="mb-2 text-sm font-semibold">Search in</h2>
          {searchScopes.filter(s => s !== 'tasks' || data?.canSearchTasks !== false).map(s => <Link key={s} href={searchUrl(q, s, mode)}
            aria-current={s === scope ? 'page' : undefined} className={linkClass(s === scope)}>{scopeLabels[s]}</Link>)}
        </nav>
        {(scope === 'all' || scope === 'sessions') && <nav aria-label="Session matching"><h2 className="mb-2 text-sm font-semibold">Session matching</h2>
          {(['keyword', 'hybrid'] as const).map(m => <Link key={m} href={searchUrl(q, scope, m)} aria-current={m === mode ? 'true' : undefined}
            className={linkClass(m === mode)}>{m === 'keyword' ? 'Keywords only' : 'Include related sessions'}</Link>)}
        </nav>}
      </aside>
      <div className="min-w-0 space-y-4">
        {!valid ? <p role="status">{q ? 'Use at most 500 characters.' : 'Enter a keyword to search PCP.'}</p> : <>
          <p role="status" className="break-words text-sm text-slate-600 dark:text-slate-300">{!data && !error ? 'Searching…' : `Results for “${q}”`}</p>
          {(error || data?.sessionError) && <p role="alert" className="rounded-md border p-3 text-sm">{error || data?.sessionError} <button className="underline" onClick={() => { setError(''); setData(null); setRetry(n => n + 1); }}>Try again</button></p>}
          {data?.projects && <ResultSection section="projects" hits={data.projects} pattern={pattern()} />}
          {data?.tasks && <ResultSection section="tasks" hits={data.tasks} pattern={pattern()} />}
          {data?.results && <ResultSection section="sessions" hits={data.results} pattern={pattern(true)} />}
          {mode === 'hybrid' && data?.results && !data.semantic && <p className="text-sm text-slate-500">Only keyword results are available for this search.</p>}
        </>}
      </div>
    </div>
  </div>;
}
