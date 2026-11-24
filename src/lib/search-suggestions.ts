import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { os } from '../../search/client';
import { db } from './db';
import { visibleProjectsFilter } from './project-access';
import { compactions, messages, projectAliases, projects, sessions, tasks } from './schema';
import { projectTagMatch, taskNameMatch } from './search-catalog';
import type { SearchScope } from './search-options';
import { visibleSessionsFilter } from './session-access';
import { lexicalSessionQuery } from './session-search';
import type { UiActor } from './ui-auth';

const siteWords = ['sessions', 'session', 'projects', 'project', 'tasks', 'task', 'tags', 'search', 'summary', 'transcript'];

export function completionPrefix(q: string) {
  const match = /[\p{L}\p{N}]+$/u.exec(q);
  if (!match || match[0].length > 64) return null;
  return { stem: q.slice(0, match.index), prefix: match[0].toLowerCase() };
}

async function prefixSessions(prefix: string, allowed: string[]) {
  if (!allowed.length) return [];
  const data = await os('/_search', 'POST', { size: 8, _source: false, track_total_hits: false,
    query: { bool: { filter: [{ terms: { sid: allowed } }], must: [{ multi_match: {
      type: 'bool_prefix', query: prefix, fields: ['title^4', 'summary^2', 'messages.content'],
    } }] } } });
  return data.hits.hits.map((hit: { _id: string }) => hit._id) as string[];
}

/** OpenSearch nominates IDs, never text. Extract words only from live, authorized
 * rows; sample a few matching messages per session instead of scanning the corpus. */
async function candidateWords(prefix: string, scope: SearchScope, actor: UiActor, sessionIds: string[]) {
  const pattern = `\\m${prefix}[[:alnum:]]{0,64}\\M`;
  const fields: SQL[] = [];
  if (scope === 'all' || scope === 'projects') {
    fields.push(sql`select concat_ws(' ', ${projects.displayName}, ${projects.canonicalKey},
      (select string_agg(${projectAliases.aliasKey}, ' ') from ${projectAliases} where ${eq(projectAliases.projectId, projects.id)})) as body
      from ${projects} where ${visibleProjectsFilter(actor) ?? sql`true`}`);
  }
  if ((scope === 'all' || scope === 'tasks') && actor.isAdmin) fields.push(sql`select ${tasks.title} as body from ${tasks}`);
  if (sessionIds.length) {
    const visible = and(inArray(sessions.id, sessionIds), visibleSessionsFilter(actor));
    fields.push(sql`select piece.body from ${sessions} cross join lateral (
      select ${sessions.title} as body union all select ${sessions.contextTitle} union all select ${sessions.contextSummary}
      union all (select ${messages.content} from ${messages} where ${eq(messages.sessionId, sessions.id)}
        and ${messages.content} ~* ${pattern} order by ${messages.ordinal} limit 3)
      union all (select ${compactions.summary} from ${compactions} where ${eq(compactions.sessionId, sessions.id)}
        and ${compactions.summary} ~* ${pattern} order by ${compactions.createdAt} desc limit 2)
    ) piece where ${visible}`);
  }
  if (!fields.length) return [];
  const rows = await db.execute<{ word: string }>(sql`select lower(m[1]) as word from (${sql.join(fields, sql` union all `)}) fields
    cross join lateral regexp_matches(fields.body, ${pattern}, 'gi') as m
    group by lower(m[1]) order by count(*) desc, lower(m[1]) limit 16`);
  return rows.map(r => r.word);
}

/** Count the submitted queries, not occurrences in sampled text. A term in a
 * hundred messages in one session still contributes just one search result. */
async function suggestionCounts(queries: string[], scope: SearchScope, actor: UiActor, allowed: string[]) {
  const projectCount = scope === 'projects' || scope === 'all' ? sql`(select count(*) from ${projects}
    where ${and(visibleProjectsFilter(actor), projectTagMatch(sql`s.q`))})` : sql`0`;
  const taskCount = actor.isAdmin && (scope === 'tasks' || scope === 'all') ? sql`(select count(*) from ${tasks}
    where ${taskNameMatch(sql`s.q`)})` : sql`0`;
  const [rows, sessionCounts] = await Promise.all([
    db.execute<{ q: string; n: number }>(sql`select s.q, (${projectCount} + ${taskCount})::int as n
      from (values ${sql.join(queries.map(q => sql`(${q}::text)`), sql`,`)}) as s(q)`),
    allowed.length ? os('/_search', 'POST', { size: 0, track_total_hits: false, query: { terms: { sid: allowed } },
      aggs: { matches: { filters: { filters: queries.map(q => lexicalSessionQuery(q)) } } } }).then(r => {
        if (r.timed_out || r._shards?.failed) throw Error('Incomplete suggestion counts');
        return r.aggregations.matches.buckets.map((b: { doc_count: number }) => b.doc_count) as number[];
      }) : [],
  ]);
  const counts = new Map(rows.map(r => [r.q, r.n]));
  return queries.map((text, i) => ({ text, count: (counts.get(text) ?? 0) + (sessionCounts[i] ?? 0) }));
}

export async function searchSuggestions(q: string, scope: SearchScope, actor: UiActor) {
  const parts = completionPrefix(q);
  if (!parts || (scope === 'tasks' && !actor.isAdmin)) return [];
  const allowed = scope === 'sessions' || scope === 'all' ? (await db.select({ id: sessions.id }).from(sessions)
    .where(visibleSessionsFilter(actor))).map(s => s.id) : [];
  const ids = await prefixSessions(parts.prefix, allowed);
  const words = await candidateWords(parts.prefix, scope, actor, ids);
  const site = siteWords.filter(word => word.startsWith(parts.prefix));
  const queries = [...new Set([...site, ...words])].map(w => parts.stem + w).filter(text => text.length <= 500);
  if (!queries.length) return [];
  const hits = await suggestionCounts(queries, scope, actor, allowed);
  // Prefer PCP vocabulary when it matches; otherwise order by the number of results.
  const priority = (text: string) => {
    const index = site.indexOf(text.slice(parts.stem.length));
    return index === -1 ? site.length : index;
  };
  return hits.filter(h => h.count > 0)
    .sort((a, b) => priority(a.text) - priority(b.text) || b.count - a.count || a.text.localeCompare(b.text)).slice(0, 6);
}
