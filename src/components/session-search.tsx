'use client';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import type { SearchMode, SearchScope } from '@/lib/search-options';

export function searchUrl(q: string, scope: SearchScope, mode: SearchMode) {
  const params = new URLSearchParams({ q });
  if (scope !== 'all') params.set('scope', scope);
  if (mode !== 'keyword') params.set('mode', mode);
  return `/search?${params}`;
}

export function SessionSearch({ query = '', scope = 'all', mode = 'keyword' }: {
  query?: string; scope?: SearchScope; mode?: SearchMode;
}) {
  const router = useRouter();
  return <form role="search" action="/search" className="relative flex min-w-0 flex-1 items-center" onSubmit={event => {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get('q') ?? '').trim();
    if (q) router.push(searchUrl(q, scope, mode));
  }}>
    <input key={query} defaultValue={query} name="q" type="search" aria-label="Search PCP" placeholder="Search PCP" required maxLength={500}
      className="w-full rounded-md border border-slate-300 bg-white py-2 pl-3 pr-9 text-sm dark:border-slate-700 dark:bg-slate-900" />
    <button type="submit" aria-label="Submit search" className="absolute inset-y-0 right-0 px-3"><Search size={16} /></button>
  </form>;
}
