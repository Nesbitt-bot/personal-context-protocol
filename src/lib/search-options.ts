export const searchScopes = ['all', 'projects', 'tasks', 'sessions'] as const;
export type SearchScope = typeof searchScopes[number];
export type SearchMode = 'keyword' | 'hybrid';
export const scopeLabels: Record<SearchScope, string> = {
  all: 'All results', projects: 'Project tags', tasks: 'Task names', sessions: 'Session content',
};
export function isSearchScope(value: unknown): value is SearchScope {
  return searchScopes.some(scope => scope === value);
}
export interface SearchHit { id: string; title: string; snippet?: string | null }
export type SearchCategory = Exclude<SearchScope, 'all'>;
// A missing task count is unauthorized; null is an authorized but unavailable count.
export type SearchCounts = Record<Exclude<SearchScope, 'tasks'>, number | null> & { tasks?: number | null };
export interface SearchResults {
  counts: SearchCounts;
  categoryErrors?: Partial<Record<SearchCategory, string>>;
  projects?: SearchHit[];
  tasks?: SearchHit[];
  results?: SearchHit[]; // Existing session search response key.
  semantic?: boolean;
  sessionError?: string;
  canSearchTasks: boolean;
}

/** Literal terms, longest first so a shorter prefix doesn't mask a longer hit. */
export function keywordPattern(q: string, indexedWords = false) {
  const terms = q.trim().split(/\s+/u).filter(Boolean);
  // The session index also tokenizes compound names (e.g. foo-bar).
  if (indexedWords) terms.push(...(q.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []));
  return [...new Set(terms)].sort((a, b) => b.length - a.length)
    .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}
