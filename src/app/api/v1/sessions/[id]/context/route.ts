import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { sessions } from '@/lib/schema';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { validationError } from '@/lib/project-access';
import { uiSessionContextSchema } from '@/lib/project-validations';
import { applySessionContext } from '@/lib/sync-store';
import { readClock } from '@/lib/sync-policy';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Move a session into a project and edit its task context from the web UI
 * (admin). Applied as a write from device `web` that has seen the current
 * values, under the same conflict policy as plugin writes.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to update session context';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const parsed = uiSessionContextSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(consequence, 'session administration / context validation', parsed.error.errors);
    const [row] = await db.select({ clock: sessions.syncClockJson }).from(sessions).where(eq(sessions.id, params.id)).limit(1);
    if (!row) return NextResponse.json({ error: `${consequence}: session administration / session lookup - session not found`, code: 'NOT_FOUND' }, { status: 404 });
    const base: Record<string, Date> = {};
    for (const f of ['project_id', 'context_title', 'context_summary']) {
      const c = readClock(row.clock, f);
      if (c) base[f] = new Date(c.at);
    }
    const outcome = await applySessionContext(params.id, parsed.data, { at: new Date(), device: 'web', base }, `human:${auth.actor.userId}`);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
    return NextResponse.json(outcome);
  } catch (error) {
    logError({ consequence, moduleProcess: 'session administration / update context', cause: 'session context write failed', error });
    return NextResponse.json({ error: `${consequence}: session administration / update context - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
