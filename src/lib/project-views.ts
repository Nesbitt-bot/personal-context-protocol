import { and, count, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { db } from './db';
import { messages, projects, sessions } from './schema';
import { visibleProjectsFilter } from './project-access';
import { visibleSessionsFilter } from './session-access';
import { aliasesFor, projectJson, projectWorkspacesFor, workspaceJson } from './project-store';
import { conflictJson, listConflicts } from './sync-store';
import type { UiActor } from './ui-auth';

/** Read models for the projects pages, already filtered for the caller. */

export async function listProjectsFor(actor: UiActor) {
  const rows = await db.select().from(projects).where(visibleProjectsFilter(actor)).orderBy(desc(projects.updatedAt)).limit(1000);
  const ids = rows.map((r) => r.id);
  const visible = visibleSessionsFilter(actor);
  const counts = ids.length
    ? await db
        .select({ projectId: sessions.projectId, sessions: count(sessions.id), last: max(sessions.lastMessageAt) })
        .from(sessions)
        .where(and(inArray(sessions.projectId, ids), eq(sessions.archived, false), visible))
        .groupBy(sessions.projectId)
    : [];
  const workspaces = await projectWorkspacesFor(ids);
  const [unassigned] = await db.select({ n: count(sessions.id) }).from(sessions).where(and(isNull(sessions.projectId), eq(sessions.archived, false), visible));
  return {
    projects: rows.map((row) => {
      const c = counts.find((x) => x.projectId === row.id);
      const ws = workspaces.filter((w) => w.projectId === row.id);
      return {
        ...projectJson(row),
        session_count: Number(c?.sessions ?? 0),
        last_activity_at: c?.last ?? null,
        workspace_count: ws.length,
        device_kinds: [...new Set(ws.map((w) => w.deviceKind))],
      };
    }),
    unassigned_sessions: Number(unassigned?.n ?? 0),
  };
}

export async function projectDetailFor(actor: UiActor, projectId: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) return null;
  const visible = visibleSessionsFilter(actor);
  const sessionRows = await db
    .select({
      id: sessions.id, title: sessions.title, external_key: sessions.externalKey, context_title: sessions.contextTitle,
      context_summary: sessions.contextSummary, archived: sessions.archived, last_message_at: sessions.lastMessageAt,
      created_at: sessions.createdAt, message_count: sql<number>`(SELECT count(*) FROM ${messages} WHERE ${messages.sessionId} = ${sessions.id})`,
    })
    .from(sessions)
    .where(and(eq(sessions.projectId, projectId), visible))
    .orderBy(sql`${sessions.lastMessageAt} DESC NULLS LAST`, desc(sessions.createdAt))
    .limit(2000);
  const workspaces = await projectWorkspacesFor([projectId]);
  const conflicts = actor.isAdmin
    ? await listConflicts({ status: 'open', entityIds: [projectId, ...sessionRows.map((s) => s.id)] })
    : [];
  return {
    project: { ...projectJson(row), aliases: await aliasesFor(projectId) },
    workspaces: workspaces.map(workspaceJson),
    sessions: sessionRows.map((s) => ({ ...s, message_count: Number(s.message_count) })),
    conflicts: conflicts.map(conflictJson),
  };
}
