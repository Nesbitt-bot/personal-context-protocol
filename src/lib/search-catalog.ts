import { and, asc, eq, ilike, inArray, or, sql, type SQLWrapper } from 'drizzle-orm';
import { db } from './db';
import { compactions, messages, projectAliases, projects, sessions, tasks } from './schema';
import { visibleProjectsFilter } from './project-access';
import { visibleSessionsFilter } from './session-access';
import { searchSessions } from './session-search';
import { keywordPattern, type SearchMode } from './search-options';
import type { UiActor } from './ui-auth';

const limit = 20;
const literalLike = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

export async function searchProjectTags(q: string, actor: UiActor) {
  const pattern = literalLike(q);
  const alias = sql<string | null>`(select ${projectAliases.aliasKey} from ${projectAliases}
    where ${projectAliases.projectId} = ${projects.id} and ${ilike(projectAliases.aliasKey, pattern)}
    order by ${projectAliases.aliasKey} limit 1)`;
  return db.select({ id: projects.id, title: projects.displayName, snippet: sql<string>`coalesce(${alias}, ${projects.canonicalKey})` })
    .from(projects).where(and(visibleProjectsFilter(actor), or(ilike(projects.displayName, pattern),
      ilike(projects.canonicalKey, pattern), sql`${alias} is not null`)))
    .orderBy(asc(projects.displayName), asc(projects.id)).limit(limit);
}

export async function searchTaskNames(q: string, actor: UiActor) {
  if (!actor.isAdmin) return [];
  return db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(ilike(tasks.title, literalLike(q)))
    .orderBy(asc(tasks.title), asc(tasks.id)).limit(limit);
}

/** Only OpenSearch IDs cross the index boundary. Read a bounded excerpt from a
 * currently visible, live record so deleted or edited messages cannot leak. */
export async function searchSessionContent(q: string, actor: UiActor, mode: SearchMode) {
  const visible = visibleSessionsFilter(actor);
  const allowed = visible ? (await db.select({ id: sessions.id }).from(sessions).where(visible)).map(row => row.id) : undefined;
  const { ids, semantic } = await searchSessions(q, allowed, mode);
  const top = ids.slice(0, limit);
  if (!top.length) return { results: [], semantic };
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
  return { results: top.flatMap(id => byId.get(id) ?? []), semantic };
}
