import { SiteNav } from '@/components/site-nav';
import { SearchWorkspace } from '@/components/search-workspace';
import { isSearchScope } from '@/lib/search-options';

export const metadata = { title: 'Search · Personal Context Protocol', referrer: 'no-referrer' };

export default function SearchPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const q = typeof searchParams.q === 'string' ? searchParams.q.trim() : '';
  const scope = isSearchScope(searchParams.scope) ? searchParams.scope : 'all';
  const mode = searchParams.mode === 'hybrid' ? 'hybrid' : 'keyword';
  return <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
    <SiteNav />
    <SearchWorkspace key={JSON.stringify([q, scope, mode])} q={q} scope={scope} mode={mode} />
  </main>;
}
