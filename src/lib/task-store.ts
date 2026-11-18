import { and, eq, inArray, isNull, max } from 'drizzle-orm';
import { db } from './db';
import { events, projects, sessions, taskBoards, taskProjects, taskResources, tasks, topics } from './schema';
import { createId } from './auth';
import { generateUniqueTitle } from './naming';

/**
 * Sprint-board writes (migration 017). Tasks are units of work inside a
 * category (folder/topic); projects stay pure repo tags linked many-to-many
 * with at most one primary; sessions attach to a single task. All mutations
 * are human/admin-only and audit through the events ledger.
 */

export type TaskRow = typeof tasks.$inferSelect;

/** Client-correctable write error (bad reference, non-empty category, etc.). */
export class TaskError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const BOARD_ID = 'board_1';
const DEFAULT_TASK_TITLE = 'New Task';
const DEFAULT_BOARD_NAME = 'Sprint Board';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function audit(tx: Tx, action: string, actor: string, details: Record<string, unknown>, now: Date) {
  await tx.insert(events).values({ id: createId('evt'), action, actor, detailsJson: details, createdAt: now });
}

/** The single board row, created on first read if absent. */
export async function ensureBoard(now = new Date()) {
  const [row] = await db.select().from(taskBoards).where(eq(taskBoards.id, BOARD_ID)).limit(1);
  if (row) return row;
  const [inserted] = await db
    .insert(taskBoards)
    .values({ id: BOARD_ID, name: DEFAULT_BOARD_NAME, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: taskBoards.id })
    .returning();
  if (inserted) return inserted;
  const [again] = await db.select().from(taskBoards).where(eq(taskBoards.id, BOARD_ID)).limit(1);
  return again!;
}

export async function setBoardName(name: string, actor: string, now = new Date()) {
  await ensureBoard(now);
  const [row] = await db
    .update(taskBoards)
    .set({ name, updatedAt: now })
    .where(eq(taskBoards.id, BOARD_ID))
    .returning();
  await db.insert(events).values({ id: createId('evt'), action: 'board.renamed', actor, detailsJson: { name }, createdAt: now });
  return row;
}

/** Position just after the last sibling (tasks with the same parent/category). */
async function nextSiblingPosition(tx: Tx, topicId: string | null, parentId: string | null): Promise<number> {
  const where = parentId
    ? eq(tasks.parentId, parentId)
    : topicId
      ? and(eq(tasks.topicId, topicId), isNull(tasks.parentId))
      : and(isNull(tasks.topicId), isNull(tasks.parentId));
  const [row] = await tx.select({ m: max(tasks.position) }).from(tasks).where(where);
  return Number(row?.m ?? 0) + 1;
}

export interface CreateTaskInput {
  title?: string | null;
  description?: string | null;
  externalKey?: string | null;
  topicId?: string | null;
  parentId?: string | null;
  priority?: number | null;
  expectedTurns?: number | null;
  dueAt?: string | null;
  projectIds?: string[];
  primaryProjectId?: string | null;
}

export async function createTask(input: CreateTaskInput, actor: string, now = new Date()) {
  if (input.projectIds?.length) await assertProjectIds([...new Set(input.projectIds)]);
  return db.transaction(async (tx) => {
    let topicId = input.topicId ?? null;
    let parentId = input.parentId ?? null;
    if (parentId) {
      const [parent] = await tx.select().from(tasks).where(eq(tasks.id, parentId)).limit(1);
      if (!parent) throw new TaskError('parent task not found');
      topicId = parent.topicId; // a subtask inherits its parent's category
    }
    if (topicId) {
      const [topic] = await tx.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId)).limit(1);
      if (!topic) throw new TaskError('category not found');
    }

    const existing = await tx.select({ title: tasks.title }).from(tasks);
    const title = generateUniqueTitle(input.title, existing.map((t) => t.title), DEFAULT_TASK_TITLE);
    const position = await nextSiblingPosition(tx, topicId, parentId);
    const id = createId('tsk');

    const [row] = await tx
      .insert(tasks)
      .values({
        id,
        parentId,
        topicId,
        title,
        description: input.description || null,
        externalKey: input.externalKey || null,
        priority: clampPriority(input.priority),
        expectedTurns: input.expectedTurns ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        position,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (input.projectIds?.length) {
      await setTaskProjectsInternal(tx, id, input.projectIds, input.primaryProjectId ?? null, now);
    }

    await audit(tx, 'task.created', actor, { task_id: id, title, topic_id: topicId, parent_id: parentId }, now);
    return row;
  });
}

function clampPriority(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Math.max(0, Math.min(3, Math.trunc(value)));
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  topicId?: string | null;
  parentId?: string | null;
  completed?: boolean;
  priority?: number | null;
  expectedTurns?: number | null;
  dueAt?: string | null;
  position?: number;
}

export async function updateTask(id: string, patch: UpdateTaskInput, actor: string, now = new Date()) {
  const [current] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!current) return null;

  const set: Partial<TaskRow> = { updatedAt: now };
  if (patch.title !== undefined) set.title = patch.title.trim().slice(0, 200) || current.title;
  if (patch.description !== undefined) set.description = patch.description || null;
  if (patch.priority !== undefined) set.priority = clampPriority(patch.priority);
  if (patch.expectedTurns !== undefined) set.expectedTurns = patch.expectedTurns;
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt ? new Date(patch.dueAt) : null;
  if (patch.position !== undefined) set.position = patch.position;
  if (patch.topicId !== undefined) set.topicId = patch.topicId;
  if (patch.parentId !== undefined) {
    set.parentId = patch.parentId;
    if (patch.parentId) {
      const [parent] = await db.select().from(tasks).where(eq(tasks.id, patch.parentId)).limit(1);
      if (!parent) throw new TaskError('parent task not found');
      set.topicId = parent.topicId; // inherit the new parent's category
    }
  }
  if (patch.completed !== undefined) {
    set.completed = patch.completed;
    set.completedAt = patch.completed ? now : null;
  }

  const [row] = await db.update(tasks).set(set).where(eq(tasks.id, id)).returning();
  await db.insert(events).values({ id: createId('evt'), action: 'task.updated', actor, detailsJson: { task_id: id, fields: Object.keys(patch) }, createdAt: now });
  return row;
}

/** Delete a task only when it has no subtasks (a completed task may be deleted too). */
export async function deleteTask(id: string, actor: string, now = new Date()) {
  const [children] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.parentId, id)).limit(1);
  if (children) throw new TaskError('task has subtasks; delete them first', 409);
  const [row] = await db.delete(tasks).where(eq(tasks.id, id)).returning();
  if (row) {
    await db.insert(events).values({ id: createId('evt'), action: 'task.deleted', actor, detailsJson: { task_id: id, title: row.title }, createdAt: now });
  }
  return row ?? null;
}

async function setTaskProjectsInternal(tx: Tx, taskId: string, projectIds: string[], primaryProjectId: string | null, now: Date) {
  const unique = [...new Set(projectIds)];
  await tx.delete(taskProjects).where(eq(taskProjects.taskId, taskId));
  for (const projectId of unique) {
    await tx
      .insert(taskProjects)
      .values({ taskId, projectId, isPrimary: projectId === primaryProjectId, createdAt: now })
      .onConflictDoNothing({ target: [taskProjects.taskId, taskProjects.projectId] });
  }
}

export async function setTaskProjects(taskId: string, projectIds: string[], primaryProjectId: string | null, actor: string, now = new Date()) {
  const ids = [...new Set(projectIds)];
  if (primaryProjectId && !ids.includes(primaryProjectId)) throw new TaskError('primary project must be one of the linked projects');
  await assertProjectIds(ids);
  return db.transaction(async (tx) => {
    await setTaskProjectsInternal(tx, taskId, ids, primaryProjectId, now);
    await audit(tx, 'task.projects_set', actor, { task_id: taskId, project_ids: ids, primary_project_id: primaryProjectId }, now);
    return ids;
  });
}

async function assertProjectIds(ids: string[]) {
  if (!ids.length) return;
  const rows = await db.select({ id: projects.id }).from(projects).where(inArray(projects.id, ids));
  if (rows.length !== ids.length) throw new TaskError('one or more projects not found');
}

export async function addTaskResource(taskId: string, input: { title: string; url: string; kind?: 'doc' | 'remote' | 'local'; source?: 'agent' | 'human' }, actor: string, now = new Date()) {
  const [row] = await db
    .insert(taskResources)
    .values({ id: createId('res'), taskId, title: input.title.trim(), url: input.url.trim(), kind: input.kind ?? 'doc', source: input.source ?? 'human', createdAt: now })
    .returning();
  await db.insert(events).values({ id: createId('evt'), action: 'task.resource_added', actor, detailsJson: { task_id: taskId, resource_id: row.id, kind: row.kind, source: row.source }, createdAt: now });
  return row;
}

export async function removeTaskResource(taskId: string, resourceId: string, actor: string, now = new Date()) {
  const [row] = await db
    .delete(taskResources)
    .where(and(eq(taskResources.id, resourceId), eq(taskResources.taskId, taskId)))
    .returning();
  if (row) {
    await db.insert(events).values({ id: createId('evt'), action: 'task.resource_removed', actor, detailsJson: { task_id: taskId, resource_id: resourceId }, createdAt: now });
  }
  return row ?? null;
}

export async function linkTaskSession(taskId: string, sessionId: string, actor: string, now = new Date()) {
  const [task] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new TaskError('task not found');
  const [row] = await db.update(sessions).set({ taskId, updatedAt: now }).where(eq(sessions.id, sessionId)).returning();
  if (row) {
    await db.insert(events).values({ id: createId('evt'), action: 'task.session_linked', actor, detailsJson: { task_id: taskId, session_id: sessionId }, createdAt: now });
  }
  return row ?? null;
}

export async function unlinkTaskSession(taskId: string, sessionId: string, actor: string, now = new Date()) {
  const [row] = await db
    .update(sessions)
    .set({ taskId: null, updatedAt: now })
    .where(and(eq(sessions.id, sessionId), eq(sessions.taskId, taskId)))
    .returning();
  if (row) {
    await db.insert(events).values({ id: createId('evt'), action: 'task.session_unlinked', actor, detailsJson: { task_id: taskId, session_id: sessionId }, createdAt: now });
  }
  return row ?? null;
}

/**
 * Enforce the "no session without a task" invariant: create a task named after
 * the session and link it. Idempotent in spirit — callers only invoke it for a
 * session they just created without an explicit task.
 */
export async function ensureTaskForSession(sessionId: string, title: string, topicId: string | null, externalKey: string | null, actor: string, now = new Date()) {
  const task = await createTask({ title, topicId, externalKey }, actor, now);
  await db.update(sessions).set({ taskId: task.id, updatedAt: now }).where(eq(sessions.id, sessionId));
  await db.insert(events).values({ id: createId('evt'), sessionId, action: 'task.session_linked', actor, detailsJson: { task_id: task.id, session_id: sessionId, auto: true }, createdAt: now });
  return task;
}

/**
 * Move a session to another category and keep its task consistent: the task's
 * own category follows, and every session bound to that task moves with it.
 * Returns the affected session ids and task id (or null when there is no task).
 */
export async function moveSessionWithTask(sessionId: string, topicId: string | null, actor: string, now = new Date()) {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session) return null;

  return db.transaction(async (tx) => {
    const taskId = session.taskId;
    if (!taskId) {
      await tx.update(sessions).set({ topicId, updatedAt: now }).where(eq(sessions.id, sessionId));
      await tx.insert(events).values({ id: createId('evt'), sessionId, action: 'session.moved_topic', actor, detailsJson: { topic_id: topicId }, createdAt: now });
      return { movedSessionIds: [session.id], movedTaskId: null };
    }
    const siblings = await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.taskId, taskId));
    const movedSessionIds = siblings.map((s) => s.id);
    await tx.update(sessions).set({ topicId, updatedAt: now }).where(eq(sessions.taskId, taskId));
    await tx.update(tasks).set({ topicId, updatedAt: now }).where(eq(tasks.id, taskId));
    await tx.insert(events).values({ id: createId('evt'), sessionId, action: 'task.moved_with_sessions', actor, detailsJson: { task_id: taskId, topic_id: topicId, session_ids: movedSessionIds }, createdAt: now });
    return { movedSessionIds, movedTaskId: taskId };
  });
}

export interface EnsureTaskByKeyInput {
  externalKey?: string | null;
  title?: string | null;
  topicId?: string | null;
  projectId?: string | null;
  priority?: number | null;
  expectedTurns?: number | null;
  dueAt?: string | null;
}

/**
 * Find a task by its stable external key, or create one, and apply any
 * provided attributes. Used by the sync plugins so a re-upload of the same
 * session updates its task instead of forking a new one.
 */
export async function ensureTaskByExternalKey(input: EnsureTaskByKeyInput, actor: string, now = new Date()): Promise<{ task: TaskRow; created: boolean }> {
  if (input.externalKey) {
    const [existing] = await db.select().from(tasks).where(eq(tasks.externalKey, input.externalKey)).limit(1);
    if (existing) {
      const set: Partial<TaskRow> = {};
      if (input.title) set.title = input.title.trim().slice(0, 200);
      if (input.topicId !== undefined) set.topicId = input.topicId;
      if (input.priority !== undefined) set.priority = clampPriority(input.priority);
      if (input.expectedTurns !== undefined) set.expectedTurns = input.expectedTurns;
      if (input.dueAt !== undefined) set.dueAt = input.dueAt ? new Date(input.dueAt) : null;
      if (Object.keys(set).length) {
        set.updatedAt = now;
        const [updated] = await db.update(tasks).set(set).where(eq(tasks.id, existing.id)).returning();
        existing.title = updated.title;
      }
      if (input.projectId) await setTaskProjects(existing.id, [input.projectId], input.projectId, actor, now);
      return { task: existing, created: false };
    }
  }
  const created = await createTask({
    title: input.title,
    externalKey: input.externalKey,
    topicId: input.topicId,
    priority: input.priority,
    expectedTurns: input.expectedTurns,
    dueAt: input.dueAt,
    projectIds: input.projectId ? [input.projectId] : undefined,
    primaryProjectId: input.projectId ?? undefined,
  }, actor, now);
  return { task: created, created: true };
}
