import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/schema';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { authorizeProject, validationError } from '@/lib/project-access';
import { updateProjectSchema } from '@/lib/project-validations';
import { ensureProject, projectJson } from '@/lib/project-store';
import { projectDetailFor } from '@/lib/project-views';
import { applyProjectFields } from '@/lib/sync-store';
import { readClock } from '@/lib/sync-policy';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/** Project detail: remotes, aliases, workspaces per machine, visible sessions, open conflicts (admin). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to load project';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = await authorizeProject(auth.actor, params.id, consequence);
    if (denied) return authErrorResponse(denied);
    const detail = await projectDetailFor(auth.actor, params.id);
    if (!detail) return NextResponse.json({ error: `${consequence}: project administration / project lookup - project not found`, code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    logError({ consequence, moduleProcess: 'project administration / project detail', cause: 'project, workspace or session query failed', error });
    return NextResponse.json({ error: `${consequence}: project administration / project detail - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/**
 * Edit a project (admin). Name and description go through the sync conflict
 * policy as a write from device `web` that has seen the current value, so a
 * human edit never silently drops a concurrent plugin edit. Remotes and
 * aliases are only ever added.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to update project';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const parsed = updateProjectSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(consequence, 'project administration / request validation', parsed.error.errors);
    const [row] = await db.select().from(projects).where(eq(projects.id, params.id)).limit(1);
    if (!row) return NextResponse.json({ error: `${consequence}: project administration / project lookup - project not found`, code: 'NOT_FOUND' }, { status: 404 });
    const body = parsed.data;
    const actor = `human:${auth.actor.userId}`;
    const now = new Date();
    let fields = null;
    if (body.display_name !== undefined || body.description !== undefined) {
      const base: Record<string, Date> = {};
      for (const f of ['display_name', 'description']) {
        const c = readClock(row.syncClockJson, f);
        if (c) base[f] = new Date(c.at);
      }
      const outcome = await applyProjectFields(row.id, { display_name: body.display_name, description: body.description }, { at: now, device: 'web', base }, actor, now);
      if (!outcome.ok) return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
      fields = outcome;
    }
    let extended = null;
    if (body.add_git_remotes?.length || body.add_aliases?.length) {
      const result = await ensureProject({ canonicalKey: row.canonicalKey, remotes: body.add_git_remotes, aliases: body.add_aliases }, actor, now);
      extended = { remotes_added: result.remotesAdded, aliases_added: result.aliasesAdded, alias_conflicts: result.aliasConflicts };
    }
    const [fresh] = await db.select().from(projects).where(eq(projects.id, row.id)).limit(1);
    return NextResponse.json({ project: projectJson(fresh), fields, extended });
  } catch (error) {
    logError({ consequence, moduleProcess: 'project administration / update project', cause: 'project write failed', error });
    return NextResponse.json({ error: `${consequence}: project administration / update project - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
