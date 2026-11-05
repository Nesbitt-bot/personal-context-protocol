import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { validationError } from '@/lib/project-access';
import { ensureProjectSchema } from '@/lib/project-validations';
import { ensureProject, projectJson, upsertWorkspace } from '@/lib/project-store';
import { listProjectsFor } from '@/lib/project-views';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/** Projects visible to the signed-in user, with session and workspace counts. */
export async function GET(request: NextRequest) {
  const consequence = 'Unable to list projects';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    return NextResponse.json(await listProjectsFor(auth.actor));
  } catch (error) {
    logError({ consequence, moduleProcess: 'project administration / list projects', cause: 'project query failed', error });
    return NextResponse.json({ error: `${consequence}: project administration / list projects - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/** Create (or find) a project by canonical identity. Admin only. */
export async function POST(request: NextRequest) {
  const consequence = 'Unable to create project';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const parsed = ensureProjectSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(consequence, 'project administration / request validation', parsed.error.errors);
    const body = parsed.data;
    const actor = `human:${auth.actor.userId}`;
    const result = await ensureProject({ canonicalKey: body.canonical_key, displayName: body.display_name, description: body.description, remotes: body.git_remotes, aliases: body.aliases }, actor);
    if (body.workspace) {
      const ws = body.workspace;
      await upsertWorkspace(result.project.id, { deviceId: ws.device_id, deviceLabel: ws.device_label, deviceKind: ws.device_kind, directory: ws.directory, defaultBranch: ws.default_branch, seenAt: new Date(), device: 'web' }, actor);
    }
    return NextResponse.json({ project: projectJson(result.project), created: result.created, alias_conflicts: result.aliasConflicts }, { status: result.created ? 201 : 200 });
  } catch (error) {
    logError({ consequence, moduleProcess: 'project administration / create project', cause: 'project write failed', error });
    return NextResponse.json({ error: `${consequence}: project administration / create project - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
