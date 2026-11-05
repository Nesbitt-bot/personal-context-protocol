import { NextRequest, NextResponse } from 'next/server';
import { and, eq, exists, or, SQL } from 'drizzle-orm';
import { db } from './db';
import { projects, sessions } from './schema';
import { verifyScopedToken } from './middleware';
import type { ResolvedScopedToken } from './scoped-token';
import { visibleSessionsFilter } from './session-access';
import type { UiActor, UiAuthError } from './ui-auth';

/**
 * Who may see and change projects.
 *
 * Web UI (mirrors topics): admins see every project; other users see projects
 * they own or that contain at least one session visible to them, and inside a
 * project only those sessions. Creating, editing, workspaces, conflicts and
 * merge requests are admin-only.
 *
 * Agents and plugins: a global-scope scoped token. Reads need `read_all` or
 * `manage_projects`; every write needs `manage_projects`. Never the admin
 * token, never a web session.
 */

export function visibleProjectsFilter(actor: UiActor): SQL | undefined {
  if (actor.isAdmin) return undefined;
  const sessionVisible = visibleSessionsFilter(actor);
  return or(
    eq(projects.ownerUserId, actor.userId),
    exists(db.select({ one: sessions.id }).from(sessions).where(and(eq(sessions.projectId, projects.id), sessionVisible))),
  );
}

export async function authorizeProject(actor: UiActor, projectId: string, consequence: string): Promise<UiAuthError | null> {
  const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) return { error: `${consequence}: web UI authorization / project lookup - project not found`, code: 'NOT_FOUND', status: 404 };
  if (actor.isAdmin) return null;
  const filter = visibleProjectsFilter(actor)!;
  const [visible] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), filter)).limit(1);
  if (visible) return null;
  return { error: `${consequence}: web UI authorization / project visibility check - this project is not owned by you and has none of your sessions`, code: 'FORBIDDEN', status: 403 };
}

export type ProjectTokenResult = { token: ResolvedScopedToken; actor: string } | { response: NextResponse };

/** Gate a /api/v1/manager/projects* route on a global scoped token. */
export async function requireProjectToken(request: NextRequest, consequence: string, access: 'read' | 'write'): Promise<ProjectTokenResult> {
  const auth = await verifyScopedToken(request);
  if ('error' in auth) return { response: NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status }) };
  const token = auth.token;
  if (token.scope !== 'global') {
    return { response: NextResponse.json({ error: `${consequence}: scoped token permissions / scope check - projects need a global-scope token (this one is ${token.scope}-scoped)`, code: 'FORBIDDEN' }, { status: 403 }) };
  }
  const allowed = access === 'write' ? token.permissions.manage_projects : token.permissions.manage_projects || token.permissions.read_all;
  if (!allowed) {
    const need = access === 'write' ? 'manage_projects' : 'read_all or manage_projects';
    return { response: NextResponse.json({ error: `${consequence}: scoped token permissions / ${need} check - token lacks ${need}`, code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { token, actor: `scoped:${token.id}` };
}

export function validationError(consequence: string, moduleProcess: string, details: unknown) {
  return NextResponse.json({ error: `${consequence}: ${moduleProcess} - invalid request body`, code: 'VALIDATION_ERROR', details }, { status: 400 });
}
