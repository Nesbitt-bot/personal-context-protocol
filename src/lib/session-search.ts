import { embed, os, vectorQuery } from '../../search/client';
import type { SearchMode } from './search-options';

type Hit = { _id: string };
type SearchResponse = { hits: { hits: Hit[] } };
const size = 30;

/** Rank fusion keeps BM25 and cosine scores on independent scales. */
export function mergeRanks(lists: Hit[][]): string[] {
  const scores = new Map<string, number>();
  for (const list of lists) list.forEach(({ _id }, n) => scores.set(_id, (scores.get(_id) ?? 0) + 1 / (61 + n)));
  return [...scores].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

export async function searchSessions(query: string, allowed?: string[], mode: SearchMode = 'hybrid') {
  if (allowed && !allowed.length) return { ids: [], semantic: false };
  const filter = allowed ? [{ terms: { sid: allowed } }] : [];
  const lexical: Promise<SearchResponse> = os('/_search', 'POST', { size, _source: false, query: { bool: {
    filter, must: [{ multi_match: { query, fields: ['title^4', 'summary^2', 'messages.content'] } }],
  } } });
  const semantic = (async (): Promise<SearchResponse | null> => {
    if (mode === 'keyword') return null;
    try {
      const [vector] = await embed([`task: search result | query: ${query}`], 8000);
      return await os('/_search', 'POST', vectorQuery(vector, allowed, size));
    } catch { return null; } // The keyword index remains useful during model downtime.
  })();
  const [text, vectors] = await Promise.all([lexical, semantic]);
  return { ids: mergeRanks([text.hits.hits, vectors?.hits.hits ?? []]), semantic: Boolean(vectors?.hits.hits.length) };
}
