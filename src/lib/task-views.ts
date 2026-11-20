import { asc, count, desc, eq, isNotNull, max, sql } from 'drizzle-orm';
import { db } from './db';
import { messages, projects, sessions, taskProjects, taskResources, tasks, topics } from './schema';
import { ensureBoard } from './task-store';
import { sortTasks, type BoardView, type TaskDetail, type TaskItem, type TaskSession, type TaskSortKey, type SortDir } from './task-types';
import { buildRecordingUrl } from './recording-url';

/**
 * Read models for the sprint board and task detail pages. Tasks are the
 * owner's own work items, so these run for any signed-in admin UI caller (the
 * routes gate with requireAdmin) and return the full board without visibility
 * filtering.
 */

interface TaskMeta {
  topics: Map<string, string>;
  projects: Map<string, { id: string; display_name: string }>;
  projectIds: Map<string, string[]>;
  primaryProject: Map<string, string>;
  subtaskCount: Map<string, number>;
  sessionCount: Map<string, number>;
  turns: Map<string, number>;
  lastActivity: Map<string, Date | null>;
}

async function topicTitles(): Promise<Map<string, string>> {
  const rows = await db.select({ id: topics.id, title: topics.title }).from(topics);
  return new Map(rows.map((r) => [r.id, r.title]));
}

async function projectMeta(): Promise<{ refs: Map<string, { id: string; display_name: string }>; list: Array<{ id: string; display_name: string; canonical_key: string }> }> {
  const rows = await db.select({ id: projects.id, display_name: projects.displayName, canonical_key: projects.canonicalKey }).from(projects).orderBy(asc(projects.displayName));
  const refs = new Map(rows.map((r) => [r.id, { id: r.id, display_name: r.display_name }]));
  return { refs, list: rows.map((r) => ({ id: r.id, display_name: r.display_name, canonical_key: r.canonical_key })) };
}

async function taskProjectLinks(): Promise<{ projectIds: Map<string, string[]>; primaryProject: Map<string, string> }> {
  const rows = await db.select().from(taskProjects);
  const projectIds = new Map<string, string[]>();
  const primaryProject = new Map<string, string>();
  for (const row of rows) {
    const list = projectIds.get(row.taskId) ?? [];
    list.push(row.projectId);
    projectIds.set(row.taskId, list);
    if (row.isPrimary) primaryProject.set(row.taskId, row.projectId);
  }
  return { projectIds, primaryProject };
}

async function sessionCounts(): Promise<{ sessionCount: Map<string, number>; turns: Map<string, number>; lastActivity: Map<string, Date | null> }> {
  const sessionCount = new Map<string, number>();
  const turns = new Map<string, number>();
  const lastActivity = new Map<string, Date | null>();
  const rows = await db
    .select({ taskId: sessions.taskId, n: count(sessions.id) })
    .from(sessions)
    .where(isNotNull(sessions.taskId))
    .groupBy(sessions.taskId);
  for (const row of rows) sessionCount.set(row.taskId!, Number(row.n));

  const turnRows = await db
    .select({ taskId: sessions.taskId, n: count(messages.id) })
    .from(sessions)
    .leftJoin(messages, eq(messages.sessionId, sessions.id))
    .where(isNotNull(sessions.taskId))
    .groupBy(sessions.taskId);
  for (const row of turnRows) turns.set(row.taskId!, Number(row.n));

  // Last session activity: the latest message, falling back to the session's
  // last update, so a task reflects its sessions rather than its own edit time.
  const actRows = await db
    .select({ taskId: sessions.taskId, last: max(sql<string>`COALESCE(${sessions.lastMessageAt}, ${sessions.updatedAt})`) })
    .from(sessions)
    .where(isNotNull(sessions.taskId))
    .groupBy(sessions.taskId);
  for (const row of actRows) lastActivity.set(row.taskId!, row.last ? new Date(row.last) : null);
  return { sessionCount, turns, lastActivity };
}

/** Roll each task's own turns up through its subtree. */
function rollupTurns(taskRows: typeof tasks.$inferSelect[], ownTurns: Map<string, number>, subtaskCount: Map<string, number>): Map<string, number> {
  const byParent = new Map<string, string[]>();
  for (const row of taskRows) {
    if (row.parentId) {
      const list = byParent.get(row.parentId) ?? [];
      list.push(row.id);
      byParent.set(row.parentId, list);
      subtaskCount.set(row.parentId, (subtaskCount.get(row.parentId) ?? 0) + 1);
    }
  }
  const memo = new Map<string, number>();
  const visit = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    let total = ownTurns.get(id) ?? 0;
    for (const child of byParent.get(id) ?? []) total += visit(child);
    memo.set(id, total);
    return total;
  };
  for (const row of taskRows) visit(row.id);
  return memo;
}

/** Roll each task's own last-activity up through its subtree (max timestamp). */
function rollupLastActivity(taskRows: typeof tasks.$inferSelect[], own: Map<string, Date | null>): Map<string, Date | null> {
  const byParent = new Map<string, string[]>();
  for (const row of taskRows) {
    if (row.parentId) {
      const list = byParent.get(row.parentId) ?? [];
      list.push(row.id);
      byParent.set(row.parentId, list);
    }
  }
  const memo = new Map<string, Date | null>();
  const visit = (id: string): Date | null => {
    if (memo.has(id)) return memo.get(id)!;
    let best = own.get(id) ?? null;
    for (const child of byParent.get(id) ?? []) {
      const c = visit(child);
      if (c && (!best || c.getTime() > best.getTime())) best = c;
    }
    memo.set(id, best);
    return best;
  };
  for (const row of taskRows) visit(row.id);
  return memo;
}

async function buildTaskItem(row: typeof tasks.$inferSelect, meta: TaskMeta): Promise<TaskItem> {
  const projectIds = meta.projectIds.get(row.id) ?? [];
  const primaryId = meta.primaryProject.get(row.id);
  const project = primaryId ? (meta.projects.get(primaryId) ?? null) : null;
  const currentTurns = meta.turns.get(row.id) ?? 0;
  const expected = row.expectedTurns;
  return {
    id: row.id,
    parent_id: row.parentId,
    topic_id: row.topicId,
    topic_title: row.topicId ? (meta.topics.get(row.topicId) ?? null) : null,
    title: row.title,
    description: row.description,
    completed: row.completed,
    completed_at: row.completedAt ? row.completedAt.toISOString() : null,
    priority: row.priority,
    expected_turns: expected,
    due_at: row.dueAt ? row.dueAt.toISOString() : null,
    position: row.position,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    last_activity_at: meta.lastActivity.get(row.id)?.toISOString() ?? null,
    project,
    project_ids: projectIds,
    subtask_count: meta.subtaskCount.get(row.id) ?? 0,
    session_count: meta.sessionCount.get(row.id) ?? 0,
    current_turns: currentTurns,
    progress: expected ? currentTurns / expected : null,
  };
}

export async function listBoard(sort: TaskSortKey = 'updated', dir?: SortDir): Promise<BoardView> {
  const board = await ensureBoard();
  const [topicRows, projectResult, links, counts, taskRows] = await Promise.all([
    db.select().from(topics).where(eq(topics.archived, false)).orderBy(asc(topics.title)),
    projectMeta(),
    taskProjectLinks(),
    sessionCounts(),
    db.select().from(tasks),
  ]);

  const meta: TaskMeta = {
    topics: await topicTitles(),
    projects: projectResult.refs,
    projectIds: links.projectIds,
    primaryProject: links.primaryProject,
    subtaskCount: new Map(),
    sessionCount: counts.sessionCount,
    turns: counts.turns,
    lastActivity: counts.lastActivity,
  };
  meta.turns = rollupTurns(taskRows, counts.turns, meta.subtaskCount);
  meta.lastActivity = rollupLastActivity(taskRows, counts.lastActivity);

  const categories = topicRows.map((t) => {
    let open = 0;
    let completed = 0;
    for (const task of taskRows) {
      if (task.topicId !== t.id || task.parentId) continue;
      if (task.completed) completed += 1;
      else open += 1;
    }
    return { id: t.id, title: t.title, open_count: open, completed_count: completed };
  });

  const items = await Promise.all(taskRows.map((row) => buildTaskItem(row, meta)));
  return {
    board: { id: board.id, name: board.name },
    categories,
    projects: projectResult.list,
    tasks: sortTasks(items, sort, dir),
  };
}

function healthFor(session: { projectId: string | null; lastMessageAt: Date | null }, taskPrimaryProjectId: string | null): TaskSession['health'] {
  const staleMs = 30 * 24 * 60 * 60 * 1000;
  if (!session.lastMessageAt || Date.now() - session.lastMessageAt.getTime() > staleMs) return 'stale';
  if (taskPrimaryProjectId && session.projectId && session.projectId !== taskPrimaryProjectId) return 'drift';
  return 'healthy';
}

/** Best-effort device/agent from a message's metadata/source blobs. */
function readJson(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function latestMessageMeta(sessionId: string): Promise<{ metadata: Record<string, unknown>; source: Record<string, unknown>; provider: string | null }> {
  const [row] = await db
    .select({ metadataJson: messages.metadataJson, sourceJson: messages.sourceJson, provider: messages.provider })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.ordinal))
    .limit(1);
  return { metadata: readJson(row?.metadataJson), source: readJson(row?.sourceJson), provider: row?.provider ?? null };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function taskDetail(id: string, baseUrl: string): Promise<TaskDetail | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!row) return null;

  const [topicRows, projectResult, links, counts] = await Promise.all([
    db.select().from(topics).where(eq(topics.archived, false)).orderBy(asc(topics.title)),
    projectMeta(),
    taskProjectLinks(),
    sessionCounts(),
  ]);

  const meta: TaskMeta = {
    topics: await topicTitles(),
    projects: projectResult.refs,
    projectIds: links.projectIds,
    primaryProject: links.primaryProject,
    subtaskCount: new Map(),
    sessionCount: counts.sessionCount,
    turns: counts.turns,
    lastActivity: counts.lastActivity,
  };
  // Roll turns and last-activity up through the full subtree, so a task's
  // current_turns and last_activity_at include its subtasks' sessions too.
  const allTasks = await db.select().from(tasks);
  meta.turns = rollupTurns(allTasks, counts.turns, meta.subtaskCount);
  meta.lastActivity = rollupLastActivity(allTasks, counts.lastActivity);
  const task = await buildTaskItem(row, meta);

  const categories = topicRows.map((t) => ({ id: t.id, title: t.title, open_count: 0, completed_count: 0 }));

  const sessionRows = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      context_title: sessions.contextTitle,
      external_key: sessions.externalKey,
      last_message_at: sessions.lastMessageAt,
      project_id: sessions.projectId,
      agent_name: sessions.agentName,
      device_id: sessions.deviceId,
    })
    .from(sessions)
    .where(eq(sessions.taskId, id))
    .orderBy(desc(sessions.lastMessageAt), desc(sessions.createdAt))
    .limit(500);

  const primaryProjectId = meta.primaryProject.get(id) ?? null;

  const sessionsOut: TaskSession[] = [];
  for (const s of sessionRows) {
    const [run, latest, projectName] = await Promise.all([
      db.select({ n: count(messages.id) }).from(messages).where(eq(messages.sessionId, s.id)),
      latestMessageMeta(s.id),
      s.project_id ? projectNameFor(s.project_id) : Promise.resolve(null),
    ]);
    const hostedMachine = s.device_id ?? asString(latest.metadata.device_id) ?? asString(latest.source.device_id) ?? asString(latest.metadata.merged_from_device) ?? asString(latest.metadata.machine);
    const agentName = s.agent_name ?? asString(latest.metadata.agent_name) ?? asString(latest.source.agent_name) ?? latest.provider;
    const transcriptUrl = buildRecordingUrl(baseUrl, s.id);
    sessionsOut.push({
      id: s.id,
      title: s.title,
      context_title: s.context_title,
      external_key: s.external_key,
      health: healthFor({ projectId: s.project_id, lastMessageAt: s.last_message_at }, primaryProjectId),
      run_count: Number(run[0]?.n ?? 0),
      hosted_machine: hostedMachine,
      agent_name: agentName,
      last_updated: s.last_message_at ? s.last_message_at.toISOString() : null,
      project_id: s.project_id,
      project_name: projectName,
      resume_code: [
        `# resume "${s.context_title || s.title}" (${s.id})`,
        `curl -fsSL '${transcriptUrl}/transcript' -H 'Authorization: Bearer <session-access-token>'`,
      ].join('\n'),
      session_url: `/dashboard?session=${encodeURIComponent(s.id)}`,
    });
  }

  const resourceRows = await db.select().from(taskResources).where(eq(taskResources.taskId, id)).orderBy(desc(taskResources.createdAt));
  const resources = resourceRows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    kind: r.kind,
    source: r.source,
    created_at: r.createdAt.toISOString(),
  }));

  return { task, categories, projects: projectResult.list, sessions: sessionsOut, resources };
}

async function projectNameFor(projectId: string): Promise<string | null> {
  const [row] = await db.select({ name: projects.displayName }).from(projects).where(eq(projects.id, projectId)).limit(1);
  return row?.name ?? null;
}
