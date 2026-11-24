import { and, asc, count, eq, ilike, inArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { db } from './db';
import { compactions, messages, projectAliases, projects, sessions, tasks } from './schema';
import { visibleProjectsFilter } from './project-access';
import { visibleSessionsFilter } from './session-access';
import { searchSessions } from './session-search';
import { keywordPattern, type SearchMode } from './search-options';
import type { UiActor } from './ui-auth';

const limit = 20;
// Use the same literal substring semantics for a bound query and a SQL column
// containing a raw query. Escape the escape character before the LIKE wildcards.
function literalLike(q: string | SQL) {
  if (typeof q === 'string') return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  return sql`'%' || replace(replace(replace(${q}, chr(92), chr(92)||chr(92)), '%', chr(92)||'%'), '_', chr(92)||'_') || '%'`;
}
function aliasMatch(q: string | SQL) {
  return and(eq(projectAliases.projectId, projects.id), ilike(projectAliases.aliasKey, literalLike(q)));
}
/** Match predicates only: callers must apply the project ACL / task admin gate. */
export function projectTagMatch(q: string | SQL) {
  const pattern = literalLike(q);
  return or(ilike(projects.displayName, pattern), ilike(projects.canonicalKey, pattern),
    sql`exists (select 1 from ${projectAliases} where ${aliasMatch(q)})`)!;
}
export function taskNameMatch(q: string | SQL) {
  return ilike(tasks.title, literalLike(q));
}

const windowCount = sql<number>`count(*) over ()`.mapWith(Number);
function page<T extends { total: number }>(rows: T[]) {
  return { total: rows[0]?.total ?? 0, hits: rows.map(({ total: _, ...hit }) => hit) };
}

export async function searchProjectTags(q: string, actor: UiActor, includeHits = true) {
  const where = and(visibleProjectsFilter(actor), projectTagMatch(q));
  if (!includeHits) {
    const [row] = await db.select({ total: count() }).from(projects).where(where);
    return { total: row.total, hits: undefined };
  }
  const alias = sql`(select ${projectAliases.aliasKey} from ${projectAliases} where ${aliasMatch(q)} order by ${projectAliases.aliasKey} limit 1)`;
  return page(await db.select({ id: projects.id, title: projects.displayName, snippet: sql<string>`coalesce(${alias}, ${projects.canonicalKey})`, total: windowCount })
    .from(projects).where(where).orderBy(asc(projects.displayName), asc(projects.id)).limit(limit));
}

export async function searchTaskNames(q: string, actor: UiActor, includeHits = true) {
  if (!actor.isAdmin) throw new Error('Task search requires admin access');
  const where = taskNameMatch(q);
  if (!includeHits) {
    const [row] = await db.select({ total: count() }).from(tasks).where(where);
    return { total: row.total, hits: undefined };
  }
  return page(await db.select({ id: tasks.id, title: tasks.title, total: windowCount }).from(tasks).where(where)
    .orderBy(asc(tasks.title), asc(tasks.id)).limit(limit));
}

/** Only OpenSearch IDs cross the index boundary. Read a bounded excerpt from a
 * currently visible, live record so deleted or edited messages cannot leak. */
export async function searchSessionContent(q: string, actor: UiActor, mode: SearchMode, includeHits = true) {
  const visible = visibleSessionsFilter(actor);
  // Even admins should not count deleted rows awaiting index reconciliation.
  const allowed = (await db.select({ id: sessions.id }).from(sessions).where(visible)).map(row => row.id);
  const { ids, semantic, total } = await searchSessions(q, allowed, mode, includeHits);
  if (!includeHits) return { total };
  const top = ids.slice(0, limit);
  if (!top.length) return { results: [], semantic, total };
  const pattern = keywordPattern(q, true);
  const excerpt = (field: SQLWrapper) => sql`(select substring(${field} from greatest(pos - 60, 1) for ${Math.max(240, q.length + 60)})
    from regexp_instr(${field}, ${pattern}, 1, 1, 0, 'i') as pos where pos > 0)`;
  const snippet = sql<string | null>`coalesce(
    (select ${excerpt(messages.content)} from ${messages} where ${eq(messages.sessionId, sessions.id)}
      and ${messages.content} ~* ${pattern} order by ${messages.ordinal} limit 1),
    ${excerpt(sessions.contextTitle)}, ${excerpt(sessions.contextSummary)},
    (select ${excerpt(compactions.summary)} from ${compactions} where ${eq(compactions.sessionId, sessions.id)}
      and ${compactions.summary} ~* ${pattern} order by ${compactions.createdAt} desc limit 1))`;
  const rows = await db.select({ id: sessions.id, title: sessions.title, snippet }).from(sessions)
    .where(and(visible, inArray(sessions.id, top)));
  const byId = new Map(rows.map(row => [row.id, row]));
  return { results: top.flatMap(id => byId.get(id) ?? []), semantic, total };
}
