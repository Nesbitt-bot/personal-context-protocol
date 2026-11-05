import { NextRequest, NextResponse } from 'next/server';
import { requireProjectToken, validationError } from '@/lib/project-access';
import { sessionContextSchema } from '@/lib/project-validations';
import { sessionByExternalKey } from '@/lib/manager-session-key';
import { applySessionContext } from '@/lib/sync-store';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Attach a session to a project and/or set its per-task context, from a
 * plugin running on one machine. Carries the plugin's `updated_at` and
 * `device_id`; resolved by the sync conflict policy (docs/protocol.md).
 */
export async function PATCH(request: NextRequest, { params }: { params: { key: string } }) {
  const consequence = 'Unable to sync session context';
  try {
    const gate = await requireProjectToken(request, consequence, 'write');
    if ('response' in gate) return gate.response;
    const parsed = sessionContextSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(consequence, 'session sync / request validation', parsed.error.errors);
    const session = await sessionByExternalKey(params.key);
    if (session && 'error' in session) return NextResponse.json({ error: `${consequence}: session sync / external key validation - ${session.error}`, code: 'VALIDATION_ERROR' }, { status: 400 });
    if (!session) return NextResponse.json({ error: `${consequence}: session sync / session lookup - no session has this external key`, code: 'NOT_FOUND' }, { status: 404 });
    const body = parsed.data;
    const base = Object.fromEntries(Object.entries(body.base_updated_at || {}).map(([k, v]) => [k, new Date(v as string)]));
    const outcome = await applySessionContext(session.id, {
      project_id: body.project_id, context_title: body.context_title, context_summary: body.context_summary,
    }, { at: new Date(body.updated_at), device: body.device_id, base }, gate.actor);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
    return NextResponse.json({ session_id: session.id, ...outcome });
  } catch (error) {
    logError({ consequence, moduleProcess: 'session sync / apply context', cause: 'session lock, conflict record or update failed', error });
    return NextResponse.json({ error: `${consequence}: session sync / apply context - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
