import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import { events, mergeTasks, messages, messageSyncKeys, projects, sessions, syncConflicts } from './schema';
import { createId } from './auth';
import { decideFieldWrite, planMessageMerge, readClock, type ClockMap, type ConflictRecord } from './sync-policy';

/**
 * Multi-machine writes to sessions and projects under the sync conflict
 * policy (src/lib/sync-policy.ts), the conflict log and AI merge tasks.
 * Nothing here deletes or rewrites a message.
 */

export const SESSION_SYNC_FIELDS = ['project_id', 'context_title', 'context_summary'] as const;
export const PROJECT_SYNC_FIELDS = ['display_name', 'description'] as const;
export type SessionSyncField = (typeof SESSION_SYNC_FIELDS)[number];
export type ProjectSyncField = (typeof PROJECT_SYNC_FIELDS)[number];
type EntityType = 'session' | 'project';

export interface SyncWrite {
  at: Date;
  device: string;
  /** Per-field clock the writer last saw (`base_updated_at`). */
  base?: Partial<Record<string, Date>>;
}

export type SyncOutcome =
  | { ok: true; applied: string[]; kept: string[]; unchanged: string[]; conflicts: string[]; clock_skew: boolean }
  | { ok: false; status: number; code: string; error: string };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function recordConflict(tx: Tx, entityType: EntityType, entityId: string, conflict: ConflictRecord, now: Date) {
  const id = createId('cfl');
  await tx.insert(syncConflicts).values({
    id,
    entityType,
    entityId,
    field: conflict.field,
    reason: conflict.reason,
    keptValueJson: conflict.kept.value as object,
    keptAt: new Date(conflict.kept.at),
    keptDevice: conflict.kept.device,
    lostValueJson: conflict.lost.value as object,
    lostAt: new Date(conflict.lost.at),
    lostDevice: conflict.lost.device,
    status: 'open',
    createdAt: now,
  });
  return id;
}

/** Run the policy over a set of fields; returns the column updates and outcome lists. */
async function applyFields(
  tx: Tx,
  entityType: EntityType,
  entityId: string,
  current: Record<string, unknown>,
  clockIn: unknown,
  fields: Record<string, unknown>,
  write: SyncWrite,
  reviewable: (field: string) => boolean,
  now: Date,
) {
  const clock: ClockMap = { ...((clockIn as ClockMap) || {}) };
  const updates: Record<string, unknown> = {};
  const applied: string[] = [];
  const kept: string[] = [];
  const unchanged: string[] = [];
  const conflicts: string[] = [];
  let skew = false;
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const decision = decideFieldWrite(field, current[field], readClock(clock, field), { value, at: write.at, device: write.device, base: write.base?.[field] ?? null }, { reviewable: reviewable(field), now });
    skew ||= decision.skewed;
    if (decision.action === 'apply') {
      clock[field] = decision.clock;
      updates[field] = value;
      applied.push(field);
      if (decision.conflict) conflicts.push(await recordConflict(tx, entityType, entityId, decision.conflict, now));
    } else if (decision.action === 'touch') {
      clock[field] = decision.clock;
      unchanged.push(field);
    } else {
      kept.push(field);
      if (decision.conflict) conflicts.push(await recordConflict(tx, entityType, entityId, decision.conflict, now));
    }
  }
  return { clock, updates, applied, kept, unchanged, conflicts, skew };
}

/**
 * Attach a session to a project and/or set its per-task context from a
 * plugin write. `project_id` is plain last-writer-wins; title and summary are
 * reviewable (a concurrent edit from another machine leaves a conflict).
 */
export async function applySessionContext(
  sessionId: string,
  fields: Partial<Record<SessionSyncField, string | null>>,
  write: SyncWrite,
  actor: string,
  now = new Date(),
): Promise<SyncOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: sessions.id, topicId: sessions.topicId, projectId: sessions.projectId, contextTitle: sessions.contextTitle, contextSummary: sessions.contextSummary, clock: sessions.syncClockJson })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1)
      .for('update');
    if (!row) return { ok: false as const, status: 404, code: 'NOT_FOUND', error: 'Unable to sync session context: session sync / session lookup - session not found' };
    if (fields.project_id) {
      const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, fields.project_id)).limit(1);
      if (!project) return { ok: false as const, status: 404, code: 'NOT_FOUND', error: 'Unable to sync session context: session sync / project lookup - project_id does not exist' };
    }
    const current = { project_id: row.projectId, context_title: row.contextTitle, context_summary: row.contextSummary };
    const result = await applyFields(tx, 'session', row.id, current, row.clock, fields, write, (f) => f !== 'project_id', now);
    const set: Partial<typeof sessions.$inferInsert> = { syncClockJson: result.clock };
    if ('project_id' in result.updates) set.projectId = result.updates.project_id as string | null;
    if ('context_title' in result.updates) set.contextTitle = result.updates.context_title as string | null;
    if ('context_summary' in result.updates) set.contextSummary = result.updates.context_summary as string | null;
    if (result.applied.length) set.updatedAt = now;
    if (result.applied.length || result.unchanged.length) await tx.update(sessions).set(set).where(eq(sessions.id, row.id));
    if (result.applied.length || result.conflicts.length || result.skew) {
      await tx.insert(events).values({
        id: createId('evt'), sessionId: row.id, topicId: row.topicId, action: 'session.context_synced', actor,
        detailsJson: { applied: result.applied, kept: result.kept, conflicts: result.conflicts, device: write.device, updated_at: write.at.toISOString(), clock_skew: result.skew },
        createdAt: now,
      });
    }
    return { ok: true as const, applied: result.applied, kept: result.kept, unchanged: result.unchanged, conflicts: result.conflicts, clock_skew: result.skew };
  });
}

/** Display name and description edits from a plugin or the UI (both reviewable). */
export async function applyProjectFields(
  projectId: string,
  fields: Partial<Record<ProjectSyncField, string | null>>,
  write: SyncWrite,
  actor: string,
  now = new Date(),
): Promise<SyncOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1).for('update');
    if (!row) return { ok: false as const, status: 404, code: 'NOT_FOUND', error: 'Unable to update project: project sync / project lookup - project not found' };
    const current = { display_name: row.displayName, description: row.description };
    const result = await applyFields(tx, 'project', row.id, current, row.syncClockJson, fields, write, () => true, now);
    const set: Partial<typeof projects.$inferInsert> = { syncClockJson: result.clock };
    if ('display_name' in result.updates) set.displayName = String(result.updates.display_name || row.displayName);
    if ('description' in result.updates) set.description = (result.updates.description as string | null) ?? null;
    if (result.applied.length) set.updatedAt = now;
    if (result.applied.length || result.unchanged.length) await tx.update(projects).set(set).where(eq(projects.id, row.id));
    if (result.applied.length || result.conflicts.length) {
      await tx.insert(events).values({ id: createId('evt'), action: 'project.fields_synced', actor, detailsJson: { project_id: row.id, applied: result.applied, kept: result.kept, conflicts: result.conflicts, device: write.device }, createdAt: now });
    }
    return { ok: true as const, applied: result.applied, kept: result.kept, unchanged: result.unchanged, conflicts: result.conflicts, clock_skew: result.skew };
  });
}

export interface MergeMessage {
  external_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'correction';
  content: string;
  provider?: string;
  base_model?: string;
  provider_timestamp?: string | null;
}

/** Append-only multi-machine message merge, idempotent by message id. */
export async function mergeSessionMessages(sessionId: string, incoming: MergeMessage[], device: string, actor: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [session] = await tx.select({ id: sessions.id, topicId: sessions.topicId, archived: sessions.archived }).from(sessions).where(eq(sessions.id, sessionId)).limit(1).for('update');
    if (!session) return { ok: false as const, status: 404, code: 'NOT_FOUND', error: 'Unable to merge messages: session sync / session lookup - session not found' };
    if (session.archived) return { ok: false as const, status: 409, code: 'SESSION_ARCHIVED', error: 'Unable to merge messages: session sync / session lookup - the session is archived' };
    const ids = incoming.map((m) => m.external_id);
    const existing = ids.length
      ? await tx.select({ id: messages.externalMessageId }).from(messages).where(and(eq(messages.sessionId, session.id), inArray(messages.externalMessageId, ids)))
      : [];
    const aliases = await tx.select().from(messageSyncKeys).where(eq(messageSyncKeys.sessionId, session.id));
    const known = new Set([...existing.map((r) => r.id as string), ...aliases.map(row => row.externalId)]);
    const claimed = new Set(aliases.map(row => row.messageId));
    // Upgrade earlier append-only imports to external IDs without changing
    // message IDs, ordinals, text, timestamps or attachment foreign keys.
    const legacy = await tx.select().from(messages).where(and(eq(messages.sessionId, session.id), isNull(messages.externalMessageId))).orderBy(messages.ordinal);
    let adopted = 0;
    for (const message of incoming) {
      if (known.has(message.external_id)) continue;
      const timestamp = message.provider_timestamp ? new Date(message.provider_timestamp).getTime() : null;
      const index = legacy.findIndex(row => !claimed.has(row.id) && row.role === message.role && row.content === message.content
        && (row.providerTimestamp?.getTime() ?? null) === timestamp
        && (row.provider || 'unknown') === (message.provider || 'unknown'));
      if (index < 0) continue;
      const [row] = legacy.splice(index, 1);
      await tx.insert(messageSyncKeys).values({ sessionId: session.id, externalId: message.external_id, messageId: row.id });
      known.add(message.external_id); adopted += 1;
    }
    const plan = planMessageMerge(known, incoming);
    const [max] = await tx.select({ max: sql<number>`max(${messages.ordinal})` }).from(messages).where(eq(messages.sessionId, session.id));
    let ordinal = (max?.max ? Number(max.max) : 0) + 1;
    const firstOrdinal = ordinal;
    for (const m of plan.append) {
      await tx.insert(messages).values({
        id: createId('msg'), sessionId: session.id, topicId: session.topicId, ordinal, role: m.role, content: m.content, contentType: 'markdown',
        provider: m.provider || 'unknown', BaseModel: m.base_model || 'unknown',
        providerTimestamp: m.provider_timestamp ? new Date(m.provider_timestamp) : null,
        observedAt: now, sourceJson: null, metadataJson: { merged_from_device: device }, createdAt: now, externalMessageId: m.external_id,
      });
      ordinal += 1;
    }
    if (plan.append.length || adopted) {
      if (plan.append.length) await tx.update(sessions).set({ lastMessageAt: now }).where(eq(sessions.id, session.id));
      await tx.insert(events).values({ id: createId('evt'), sessionId: session.id, topicId: session.topicId, action: 'messages.merged', actor, detailsJson: { device, adopted, appended: plan.append.length, duplicates: plan.duplicates, first_ordinal: firstOrdinal }, createdAt: now });
    }
    return { ok: true as const, adopted, appended: plan.append.length, duplicates: plan.duplicates, first_ordinal: plan.append.length ? firstOrdinal : null };
  });
}

export type ConflictRow = typeof syncConflicts.$inferSelect;
export type MergeTaskRow = typeof mergeTasks.$inferSelect;

export function conflictJson(row: ConflictRow) {
  return {
    id: row.id, entity_type: row.entityType, entity_id: row.entityId, field: row.field, reason: row.reason, status: row.status,
    kept: { value: row.keptValueJson, at: row.keptAt, device: row.keptDevice },
    lost: { value: row.lostValueJson, at: row.lostAt, device: row.lostDevice },
    created_at: row.createdAt, resolved_at: row.resolvedAt, resolved_by: row.resolvedBy,
  };
}

export function mergeTaskJson(row: MergeTaskRow) {
  return {
    id: row.id, conflict_id: row.conflictId, entity_type: row.entityType, entity_id: row.entityId, field: row.field,
    versions: row.versionsJson, instructions: row.instructions, status: row.status, requested_by: row.requestedBy,
    result_value: row.resultValueJson, completed_by: row.completedBy, created_at: row.createdAt, completed_at: row.completedAt,
  };
}

export async function listConflicts(filter: { status?: string; entityIds?: string[] }) {
  const where = [] as ReturnType<typeof eq>[];
  if (filter.status) where.push(eq(syncConflicts.status, filter.status as ConflictRow['status']));
  if (filter.entityIds) {
    if (!filter.entityIds.length) return [];
    where.push(inArray(syncConflicts.entityId, filter.entityIds));
  }
  return db.select().from(syncConflicts).where(where.length ? and(...where) : undefined).orderBy(desc(syncConflicts.createdAt)).limit(200);
}

export async function setConflictStatus(id: string, status: 'resolved' | 'dismissed', by: string, now = new Date()) {
  const [row] = await db.update(syncConflicts).set({ status, resolvedAt: now, resolvedBy: by }).where(and(eq(syncConflicts.id, id), eq(syncConflicts.status, 'open'))).returning();
  return row || null;
}

const MERGE_INSTRUCTIONS =
  'Merge these versions of one field into a single value that keeps every fact and decision from each. ' +
  'Do not invent content. Post the merged value to POST /api/v1/manager/merge-tasks/<id>/complete.';

/** Store a pending AI merge request for a conflict (idempotent per open conflict). PCP never calls a model. */
export async function requestMergeTask(conflictId: string, requestedBy: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [conflict] = await tx.select().from(syncConflicts).where(eq(syncConflicts.id, conflictId)).limit(1).for('update');
    if (!conflict) return { ok: false as const, status: 404, code: 'NOT_FOUND', error: 'Unable to request AI merge: sync conflicts / conflict lookup - conflict not found' };
    const [pending] = await tx.select().from(mergeTasks).where(and(eq(mergeTasks.conflictId, conflictId), eq(mergeTasks.status, 'pending'))).limit(1);
    if (pending) return { ok: true as const, created: false, task: pending };
    const versions = [
      { label: 'kept', value: conflict.keptValueJson, at: conflict.keptAt, device: conflict.keptDevice },
      { label: 'lost', value: conflict.lostValueJson, at: conflict.lostAt, device: conflict.lostDevice },
    ];
    const [task] = await tx.insert(mergeTasks).values({
      id: createId('mrg'), conflictId, entityType: conflict.entityType, entityId: conflict.entityId, field: conflict.field,
      versionsJson: versions, instructions: MERGE_INSTRUCTIONS, status: 'pending', requestedBy, createdAt: now,
    }).returning();
    await tx.insert(events).values({ id: createId('evt'), sessionId: conflict.entityType === 'session' ? conflict.entityId : null, action: 'merge_task.requested', actor: requestedBy, detailsJson: { merge_task_id: task.id, conflict_id: conflictId, field: conflict.field }, createdAt: now });
    return { ok: true as const, created: true, task };
  });
}

export async function listMergeTasks(status: MergeTaskRow['status'] = 'pending') {
  return db.select().from(mergeTasks).where(eq(mergeTasks.status, status)).orderBy(mergeTasks.createdAt).limit(100);
}

/**
 * An agent posts the merged value. It is applied as a fresh write that
 * fast-forwards from the current clock (so it is not itself a conflict), the
 * task is completed and its conflict resolved.
 */
export async function completeMergeTask(taskId: string, value: string, completedBy: string, now = new Date()) {
  const [task] = await db.select().from(mergeTasks).where(eq(mergeTasks.id, taskId)).limit(1);
  if (!task) return { ok: false as const, status: 404, code: 'NOT_FOUND', error: 'Unable to complete merge task: merge tasks / task lookup - task not found' };
  if (task.status !== 'pending') return { ok: false as const, status: 409, code: 'NOT_PENDING', error: `Unable to complete merge task: merge tasks / status check - task is ${task.status}` };
  const table = task.entityType === 'session' ? sessions : projects;
  const [row] = await db.select({ clock: table.syncClockJson }).from(table).where(eq(table.id, task.entityId)).limit(1);
  const base = readClock(row?.clock, task.field);
  const write: SyncWrite = { at: now, device: `ai-merge:${completedBy}`.slice(0, 120), base: base ? { [task.field]: new Date(base.at) } : {} };
  const outcome = task.entityType === 'session'
    ? await applySessionContext(task.entityId, { [task.field]: value } as Partial<Record<SessionSyncField, string>>, write, completedBy, now)
    : await applyProjectFields(task.entityId, { [task.field]: value } as Partial<Record<ProjectSyncField, string>>, write, completedBy, now);
  if (!outcome.ok) return outcome;
  const [done] = await db.update(mergeTasks).set({ status: 'completed', resultValueJson: value, completedBy, completedAt: now }).where(and(eq(mergeTasks.id, taskId), eq(mergeTasks.status, 'pending'))).returning();
  if (task.conflictId) await setConflictStatus(task.conflictId, 'resolved', completedBy, now);
  return { ok: true as const, task: done, applied: outcome.applied };
}
