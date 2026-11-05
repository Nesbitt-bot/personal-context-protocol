import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/schema';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { validationError } from '@/lib/project-access';
import { workspaceSchema } from '@/lib/project-validations';
import { upsertWorkspace, workspaceJson } from '@/lib/project-store';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/** Add a workspace by hand (admin), e.g. a new remote Linux machine. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to add workspace';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const parsed = workspaceSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(consequence, 'project administration / workspace validation', parsed.error.errors);
    const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, params.id)).limit(1);
    if (!project) return NextResponse.json({ error: `${consequence}: project administration / project lookup - project not found`, code: 'NOT_FOUND' }, { status: 404 });
    const ws = parsed.data;
    const out = await upsertWorkspace(project.id, { deviceId: ws.device_id, deviceLabel: ws.device_label, deviceKind: ws.device_kind, directory: ws.directory, defaultBranch: ws.default_branch, seenAt: new Date(), device: 'web' }, `human:${auth.actor.userId}`);
    return NextResponse.json({ workspace: workspaceJson(out.workspace), created: out.created }, { status: out.created ? 201 : 200 });
  } catch (error) {
    logError({ consequence, moduleProcess: 'project administration / add workspace', cause: 'workspace write failed', error });
    return NextResponse.json({ error: `${consequence}: project administration / add workspace - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
