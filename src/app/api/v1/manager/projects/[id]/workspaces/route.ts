import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/schema';
import { requireProjectToken, validationError } from '@/lib/project-access';
import { workspaceSchema } from '@/lib/project-validations';
import { upsertWorkspace, workspaceJson } from '@/lib/project-store';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/** Register or refresh the caller's checkout of a project (manage_projects). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to register workspace';
  try {
    const gate = await requireProjectToken(request, consequence, 'write');
    if ('response' in gate) return gate.response;
    const parsed = workspaceSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(consequence, 'project manager API / workspace validation', parsed.error.errors);
    const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, params.id)).limit(1);
    if (!project) return NextResponse.json({ error: `${consequence}: project manager API / project lookup - project not found`, code: 'NOT_FOUND' }, { status: 404 });
    const ws = parsed.data;
    const out = await upsertWorkspace(project.id, {
      deviceId: ws.device_id, deviceLabel: ws.device_label, deviceKind: ws.device_kind, directory: ws.directory,
      defaultBranch: ws.default_branch, seenAt: ws.seen_at ? new Date(ws.seen_at) : new Date(), device: ws.device_id,
    }, gate.actor);
    return NextResponse.json({ workspace: workspaceJson(out.workspace), created: out.created, changed: out.changed }, { status: out.created ? 201 : 200 });
  } catch (error) {
    logError({ consequence, moduleProcess: 'project manager API / register workspace', cause: 'workspace write failed', error });
    return NextResponse.json({ error: `${consequence}: project manager API / register workspace - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
