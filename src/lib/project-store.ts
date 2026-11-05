import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { events, projectAliases, projects, projectWorkspaces } from './schema';
import { createId } from './auth';
import {
  canonicalKeyFor,
  DeviceKind,
  directoryBasename,
  mergeRemotes,
  nameCanonicalKey,
  normalizeDirectory,
  normalizeRemote,
  remoteCanonicalKey,
} from './project-identity';
import { decideFieldWrite, readClock, type ClockMap } from './sync-policy';

/**
 * Projects, aliases and per-machine workspaces (migration 013).
 *
 * Writes here are additive: projects and workspaces are created or extended,
 * remotes and aliases are only ever added, and scalar fields follow the sync
 * conflict policy. Nothing in this module deletes a row.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ProjectRow = typeof projects.$inferSelect;
export type WorkspaceRow = typeof projectWorkspaces.$inferSelect;

export interface EnsureProjectInput {
  canonicalKey?: string | null;
  displayName?: string | null;
  description?: string | null;
  remotes?: string[];
  aliases?: string[];
  ownerUserId?: string | null;
}

export interface EnsureProjectResult {
  project: ProjectRow;
  created: boolean;
  remotesAdded: string[];
  aliasesAdded: string[];
  /** Aliases already pointing at another project; never reassigned. */
  aliasConflicts: Array<{ alias: string; project_id: string }>;
}

const remoteMatch = (remote: string) =>
  sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${projects.gitRemotesJson}) AS r(v) WHERE lower(r.v) = ${remote.toLowerCase()})`;

/** Find a project by canonical key, alias, or any of its remotes. */
export async function findProject(input: { keys?: string[]; remotes?: string[] }, tx: Tx | typeof db = db): Promise<ProjectRow | null> {
  const keys = [...new Set((input.keys || []).filter(Boolean))];
  const remotes = mergeRemotes(input.remotes || []);
  for (const remote of remotes) keys.push(remoteCanonicalKey(remote));
  if (keys.length) {
    const [byKey] = await tx.select().from(projects).where(inArray(projects.canonicalKey, keys)).limit(1);
    if (byKey) return byKey;
    const [alias] = await tx.select({ projectId: projectAliases.projectId }).from(projectAliases).where(inArray(projectAliases.aliasKey, keys)).limit(1);
    if (alias) {
      const [row] = await tx.select().from(projects).where(eq(projects.id, alias.projectId)).limit(1);
      if (row) return row;
    }
  }
  for (const remote of remotes) {
    const [row] = await tx.select().from(projects).where(remoteMatch(remote)).limit(1);
    if (row) return row;
  }
  return null;
}

function remotesOf(row: ProjectRow): string[] {
  return Array.isArray(row.gitRemotesJson) ? (row.gitRemotesJson as unknown[]).filter((r): r is string => typeof r === 'string') : [];
}

async function audit(tx: Tx, action: string, actor: string, details: Record<string, unknown>, now: Date) {
  await tx.insert(events).values({ id: createId('evt'), action, actor, detailsJson: details, createdAt: now });
}

/**
 * Find or create the project for a canonical identity, then add any new
 * remotes and aliases. Idempotent: a repeat call changes nothing.
 */
export async function ensureProject(input: EnsureProjectInput, actor: string, now = new Date()): Promise<EnsureProjectResult> {
  const remotes = mergeRemotes(input.remotes || []);
  const canonicalKey = (input.canonicalKey || canonicalKeyFor({ remotes, name: input.displayName })).trim();
  if (!canonicalKey) throw new Error('a project needs a git remote or a name');
  const aliases = [...new Set((input.aliases || []).map((a) => a.trim().toLowerCase()).filter((a) => a && a !== canonicalKey))];

  return db.transaction(async (tx) => {
    // Input aliases are claims to add, not lookup keys: matching on them could
    // silently fold two projects together.
    let project = await findProject({ keys: [canonicalKey], remotes }, tx);
    let created = false;
    if (!project) {
      const displayName = (input.displayName || '').trim() || (remotes[0] ? directoryBasename(remotes[0]) : canonicalKey.replace(/^(git|name):/, ''));
      const [row] = await tx
        .insert(projects)
        .values({
          id: createId('prj'),
          canonicalKey,
          displayName: displayName.slice(0, 200),
          description: input.description?.slice(0, 4000) || null,
          gitRemotesJson: remotes,
          ownerUserId: input.ownerUserId ?? null,
          syncClockJson: {},
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: projects.canonicalKey })
        .returning();
      if (row) {
        project = row;
        created = true;
        await audit(tx, 'project.created', actor, { project_id: row.id, canonical_key: canonicalKey, remotes }, now);
      } else {
        // Lost a race with another writer for the same key.
        project = (await findProject({ keys: [canonicalKey] }, tx))!;
      }
    }

    const existing = remotesOf(project);
    const merged = mergeRemotes(existing, remotes);
    const remotesAdded = merged.filter((r) => !existing.some((e) => e.toLowerCase() === r.toLowerCase()));
    if (remotesAdded.length) {
      const [row] = await tx.update(projects).set({ gitRemotesJson: merged, updatedAt: now }).where(eq(projects.id, project.id)).returning();
      project = row;
    }

    const aliasesAdded: string[] = [];
    const aliasConflicts: Array<{ alias: string; project_id: string }> = [];
    for (const alias of aliases) {
      if (alias === project.canonicalKey) continue;
      const [owner] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.canonicalKey, alias)).limit(1);
      if (owner && owner.id !== project.id) { aliasConflicts.push({ alias, project_id: owner.id }); continue; }
      const [inserted] = await tx.insert(projectAliases).values({ aliasKey: alias, projectId: project.id, source: actor.slice(0, 100), createdAt: now }).onConflictDoNothing().returning();
      if (inserted) { aliasesAdded.push(alias); continue; }
      const [current] = await tx.select({ projectId: projectAliases.projectId }).from(projectAliases).where(eq(projectAliases.aliasKey, alias)).limit(1);
      if (current && current.projectId !== project.id) aliasConflicts.push({ alias, project_id: current.projectId });
    }
    if (!created && (remotesAdded.length || aliasesAdded.length)) {
      await audit(tx, 'project.extended', actor, { project_id: project.id, remotes_added: remotesAdded, aliases_added: aliasesAdded }, now);
    }
    return { project, created, remotesAdded, aliasesAdded, aliasConflicts };
  });
}

export interface ResolveInput {
  remote?: string | null;
  directory?: string | null;
  deviceId?: string | null;
  name?: string | null;
}

/** Resolve by git remote, then workspace directory (on a device), then name or alias. */
export async function resolveProject(input: ResolveInput): Promise<{ project: ProjectRow; matchedBy: 'remote' | 'workspace' | 'name' } | null> {
  if (input.remote && normalizeRemote(input.remote)) {
    const project = await findProject({ remotes: [input.remote] });
    if (project) return { project, matchedBy: 'remote' };
  }
  if (input.directory) {
    const directory = normalizeDirectory(input.directory);
    const where = input.deviceId
      ? and(eq(projectWorkspaces.deviceId, input.deviceId), eq(projectWorkspaces.directory, directory))
      : eq(projectWorkspaces.directory, directory);
    const [ws] = await db
      .select({ projectId: projectWorkspaces.projectId })
      .from(projectWorkspaces)
      .where(where)
      .orderBy(sql`${projectWorkspaces.lastSeenAt} DESC NULLS LAST`)
      .limit(1);
    if (ws) {
      const [project] = await db.select().from(projects).where(eq(projects.id, ws.projectId)).limit(1);
      if (project) return { project, matchedBy: 'workspace' };
    }
  }
  const nameKey = nameCanonicalKey(input.name || (input.directory ? directoryBasename(input.directory) : ''));
  if (nameKey) {
    const project = await findProject({ keys: [nameKey] });
    if (project) return { project, matchedBy: 'name' };
  }
  return null;
}

export interface WorkspaceInput {
  deviceId: string;
  deviceLabel?: string | null;
  deviceKind: DeviceKind;
  directory: string;
  defaultBranch?: string | null;
  seenAt: Date;
  device: string;
}

/**
 * Register a workspace or refresh it. `last_seen_at` only moves forward;
 * `default_branch` and `device_label` are last-writer-wins by plugin time.
 */
export async function upsertWorkspace(projectId: string, input: WorkspaceInput, actor: string, now = new Date()) {
  const directory = normalizeDirectory(input.directory);
  const seenAt = new Date(Math.min(input.seenAt.getTime(), now.getTime()));
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(projectWorkspaces)
      .values({
        id: createId('pws'),
        projectId,
        deviceId: input.deviceId,
        deviceLabel: input.deviceLabel || null,
        deviceKind: input.deviceKind,
        directory,
        defaultBranch: input.defaultBranch || null,
        lastSeenAt: seenAt,
        syncClockJson: Object.fromEntries(
          (['default_branch', 'device_label'] as const).filter((f) => (f === 'default_branch' ? input.defaultBranch : input.deviceLabel)).map((f) => [f, { at: seenAt.toISOString(), device: input.device }]),
        ),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      await audit(tx, 'project.workspace_registered', actor, { project_id: projectId, workspace_id: inserted.id, device_id: input.deviceId, device_kind: input.deviceKind }, now);
      return { workspace: inserted, created: true, changed: [] as string[] };
    }
    const [current] = await tx
      .select()
      .from(projectWorkspaces)
      .where(and(eq(projectWorkspaces.projectId, projectId), eq(projectWorkspaces.deviceId, input.deviceId), eq(projectWorkspaces.directory, directory)))
      .limit(1)
      .for('update');
    const clock = { ...((current.syncClockJson as ClockMap) || {}) };
    const set: Partial<WorkspaceRow> = {};
    const changed: string[] = [];
    const fields: Array<['default_branch' | 'device_label', string | null | undefined, string | null]> = [
      ['default_branch', input.defaultBranch, current.defaultBranch],
      ['device_label', input.deviceLabel, current.deviceLabel],
    ];
    for (const [field, value, currentValue] of fields) {
      if (!value) continue;
      const decision = decideFieldWrite(field, currentValue, readClock(clock, field), { value, at: input.seenAt, device: input.device }, { reviewable: false, now });
      if (decision.action === 'keep') continue;
      clock[field] = decision.clock;
      if (decision.action === 'apply') {
        if (field === 'default_branch') set.defaultBranch = value;
        else set.deviceLabel = value;
        changed.push(field);
      }
    }
    if (!current.lastSeenAt || seenAt.getTime() > current.lastSeenAt.getTime()) set.lastSeenAt = seenAt;
    if (current.deviceKind !== input.deviceKind) {
      set.deviceKind = input.deviceKind;
      changed.push('device_kind');
    }
    if (!Object.keys(set).length) return { workspace: current, created: false, changed };
    const [row] = await tx.update(projectWorkspaces).set({ ...set, syncClockJson: clock, updatedAt: now }).where(eq(projectWorkspaces.id, current.id)).returning();
    return { workspace: row, created: false, changed };
  });
}

export async function projectWorkspacesFor(projectIds: string[]): Promise<WorkspaceRow[]> {
  if (!projectIds.length) return [];
  return db.select().from(projectWorkspaces).where(inArray(projectWorkspaces.projectId, projectIds)).orderBy(projectWorkspaces.deviceKind, projectWorkspaces.deviceId, projectWorkspaces.directory);
}

export async function aliasesFor(projectId: string): Promise<string[]> {
  const rows = await db.select({ alias: projectAliases.aliasKey }).from(projectAliases).where(eq(projectAliases.projectId, projectId)).orderBy(projectAliases.aliasKey);
  return rows.map((r) => r.alias);
}

export function projectJson(row: ProjectRow) {
  return {
    id: row.id,
    canonical_key: row.canonicalKey,
    display_name: row.displayName,
    description: row.description,
    git_remotes: remotesOf(row),
    owner_user_id: row.ownerUserId,
    archived: row.archived,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function workspaceJson(row: WorkspaceRow) {
  return {
    id: row.id,
    project_id: row.projectId,
    device_id: row.deviceId,
    device_label: row.deviceLabel,
    device_kind: row.deviceKind,
    directory: row.directory,
    default_branch: row.defaultBranch,
    last_seen_at: row.lastSeenAt,
  };
}
