import { NextRequest, NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/schema';
import { requireProjectToken, validationError } from '@/lib/project-access';
import { ensureProjectSchema } from '@/lib/project-validations';
import { ensureProject, projectJson, projectWorkspacesFor, upsertWorkspace, workspaceJson } from '@/lib/project-store';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/** List projects with their workspaces (global scoped token, read_all or manage_projects). */
export async function GET(request: NextRequest) {
  const consequence = 'Unable to list projects';
  try {
    const gate = await requireProjectToken(request, consequence, 'read');
    if ('response' in gate) return gate.response;
    const rows = await db.select().from(projects).orderBy(desc(projects.updatedAt)).limit(500);
    const workspaces = await projectWorkspacesFor(rows.map((r) => r.id));
    return NextResponse.json({
      projects: rows.map((row) => ({ ...projectJson(row), workspaces: workspaces.filter((w) => w.projectId === row.id).map(workspaceJson) })),
    });
  } catch (error) {
    logError({ consequence, moduleProcess: 'project manager API / list projects', cause: 'project or workspace query failed', error });
    return NextResponse.json({ error: `${consequence}: project manager API / list projects - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/**
 * Find or create a project by canonical identity (idempotent), adding new
 * remotes and aliases, and optionally register the caller's workspace.
 * Needs manage_projects.
 */
export async function POST(request: NextRequest) {
  const consequence = 'Unable to register project';
  try {
    const gate = await requireProjectToken(request, consequence, 'write');
    if ('response' in gate) return gate.response;
    const parsed = ensureProjectSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(consequence, 'project manager API / request validation', parsed.error.errors);
    const body = parsed.data;
    const result = await ensureProject({
      canonicalKey: body.canonical_key, displayName: body.display_name, description: body.description,
      remotes: body.git_remotes, aliases: body.aliases,
    }, gate.actor);
    let workspace = null;
    if (body.workspace) {
      const ws = body.workspace;
      const seen = ws.seen_at ? new Date(ws.seen_at) : new Date();
      const out = await upsertWorkspace(result.project.id, {
        deviceId: ws.device_id, deviceLabel: ws.device_label, deviceKind: ws.device_kind, directory: ws.directory,
        defaultBranch: ws.default_branch, seenAt: seen, device: ws.device_id,
      }, gate.actor);
      workspace = { ...workspaceJson(out.workspace), created: out.created, changed: out.changed };
    }
    return NextResponse.json({
      project: projectJson(result.project),
      created: result.created,
      remotes_added: result.remotesAdded,
      aliases_added: result.aliasesAdded,
      alias_conflicts: result.aliasConflicts,
      workspace,
    }, { status: result.created ? 201 : 200 });
  } catch (error) {
    logError({ consequence, moduleProcess: 'project manager API / ensure project', cause: 'project, alias or workspace write failed', error });
    return NextResponse.json({ error: `${consequence}: project manager API / ensure project - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
