import { embed, os, vectorQuery } from '../../search/client';
import type { SearchMode } from './search-options';

type Hit = { _id: string };
type SearchResponse = {
  timed_out?: boolean; _shards?: { failed: number };
  hits: { hits: Hit[]; total?: { value: number; relation: string } };
  aggregations?: { overlap: { doc_count: number } };
};
const size = 30;

/** Query body shared by ranked results and keyword counts. */
export function lexicalSessionQuery(query: string, allowed?: string[]) {
  if (allowed?.length === 0) return { match_none: {} };
  return { bool: { filter: allowed ? [{ terms: { sid: allowed } }] : [],
    must: [{ multi_match: { query, fields: ['title^4', 'summary^2', 'messages.content'] } }],
  } };
}

/** Rank fusion keeps BM25 and cosine scores on independent scales. */
export function mergeRanks(lists: Hit[][]): string[] {
  const scores = new Map<string, number>();
  for (const list of lists) list.forEach(({ _id }, n) => scores.set(_id, (scores.get(_id) ?? 0) + 1 / (61 + n)));
  return [...scores].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

async function completeSearch(body: unknown): Promise<SearchResponse> {
  const result: SearchResponse = await os('/_search', 'POST', body);
  if (result.timed_out || result._shards?.failed) throw new Error('Incomplete session search');
  return result;
}

export async function searchSessions(query: string, allowed?: string[], mode: SearchMode = 'hybrid', includeHits = true) {
  if (allowed?.length === 0) return { ids: [], total: 0, semantic: false };
  let related: Hit[] = [];
  if (mode === 'hybrid') {
    try {
      const [vector] = await embed([`task: search result | query: ${query}`], 8000);
      const hits = (await completeSearch(vectorQuery(vector, allowed, size))).hits.hits;
      // Related-only IDs contribute to the total before SQL result hydration.
      const visible = allowed && new Set(allowed);
      related = visible ? hits.filter(hit => visible.has(hit._id)) : hits;
    } catch { /* Keep keyword search available during model or vector downtime. */ }
  }
  // Count overlap against ALL keyword matches, not just their first ranked page.
  const relatedIds = [...new Set(related.map(hit => hit._id))];
  const text = await completeSearch({ size: includeHits ? size : 0, track_total_hits: true, _source: false,
    query: lexicalSessionQuery(query, allowed), ...(relatedIds.length > 0 && {
      aggs: { overlap: { filter: { terms: { sid: relatedIds } } } },
    }),
  });
  const total = text.hits.total;
  const overlap = relatedIds.length ? text.aggregations?.overlap?.doc_count : 0;
  if (!total || total.relation !== 'eq' || !Number.isSafeInteger(total.value) || total.value < 0 ||
      overlap === undefined || !Number.isSafeInteger(overlap) || overlap < 0 || overlap > Math.min(relatedIds.length, total.value)) {
    throw new Error('Inexact session count');
  }
  return { ids: includeHits ? mergeRanks([text.hits.hits, related]) : [],
    total: total.value + relatedIds.length - overlap, semantic: relatedIds.length > 0 };
}
