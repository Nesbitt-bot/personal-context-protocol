import { NextRequest, NextResponse } from 'next/server';
import { requireProjectToken } from '@/lib/project-access';
import { deviceId } from '@/lib/project-validations';
import { projectJson, projectWorkspacesFor, resolveProject, workspaceJson } from '@/lib/project-store';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Resolve the project for a checkout:
 * `GET /api/v1/manager/projects/resolve?remote=<url>&directory=<abs path>&device_id=<id>&name=<basename>`.
 * Tries the git remote, then the registered workspace directory (on that
 * device when device_id is given), then the name or an explicit alias.
 */
export async function GET(request: NextRequest) {
  const consequence = 'Unable to resolve project';
  try {
    const gate = await requireProjectToken(request, consequence, 'read');
    if ('response' in gate) return gate.response;
    const q = request.nextUrl.searchParams;
    const input = { remote: q.get('remote'), directory: q.get('directory'), deviceId: q.get('device_id'), name: q.get('name') };
    if (!input.remote && !input.directory && !input.name) {
      return NextResponse.json({ error: `${consequence}: project manager API / query validation - give remote, directory or name`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (input.deviceId && !deviceId.safeParse(input.deviceId).success) {
      return NextResponse.json({ error: `${consequence}: project manager API / query validation - device_id is malformed`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    for (const value of Object.values(input)) {
      if (value && (value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value))) {
        return NextResponse.json({ error: `${consequence}: project manager API / query validation - parameter too long or contains control characters`, code: 'VALIDATION_ERROR' }, { status: 400 });
      }
    }
    const found = await resolveProject(input);
    if (!found) return NextResponse.json({ found: false });
    const workspaces = await projectWorkspacesFor([found.project.id]);
    return NextResponse.json({ found: true, matched_by: found.matchedBy, project: projectJson(found.project), workspaces: workspaces.map(workspaceJson) });
  } catch (error) {
    logError({ consequence, moduleProcess: 'project manager API / resolve', cause: 'project lookup failed', error });
    return NextResponse.json({ error: `${consequence}: project manager API / resolve - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
