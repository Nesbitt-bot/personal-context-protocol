import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { db } from '@/lib/db';
import { events, identities, users } from '@/lib/schema';
import { createId } from '@/lib/auth';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/** Admin: list linked platform identities, or (non-admin) your own. */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const query = db
      .select({
        principal: identities.principal,
        user_id: identities.userId,
        display_name: users.displayName,
        link_method: identities.linkMethod,
        linked_at: identities.linkedAt,
      })
      .from(identities)
      .innerJoin(users, eq(users.id, identities.userId))
      .orderBy(desc(identities.linkedAt));
    const rows = auth.actor.isAdmin ? await query : await query.where(eq(identities.userId, auth.actor.userId));
    return NextResponse.json({ identities: rows });
  } catch (error) {
    logError({ consequence: 'Unable to list identities', moduleProcess: 'identity administration / list identities', cause: 'identity query failed', error });
    return NextResponse.json({ error: 'Unable to list identities: identity administration / list identities - identity query failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/** Admin: unlink a principal (body `{ principal }`). Session owners are kept. */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, 'Unable to unlink identity');
    if (denied) return authErrorResponse(denied);

    const body = await request.json().catch(() => ({}));
    const principal = typeof body?.principal === 'string' ? body.principal : '';
    const removed = await db.delete(identities).where(eq(identities.principal, principal)).returning({ userId: identities.userId });
    if (removed.length === 0) {
      return NextResponse.json({ error: 'Unable to unlink identity: identity administration / identity lookup - principal is not linked', code: 'NOT_FOUND' }, { status: 404 });
    }
    await db.insert(events).values({
      id: createId('evt'),
      action: 'identity.unlinked',
      actor: 'human',
      detailsJson: { principal, user_id: removed[0].userId, by: auth.actor.userId },
      createdAt: new Date(),
    });
    return NextResponse.json({ success: true, principal });
  } catch (error) {
    logError({ consequence: 'Unable to unlink identity', moduleProcess: 'identity administration / unlink identity', cause: 'identity delete or audit insert failed', error });
    return NextResponse.json({ error: 'Unable to unlink identity: identity administration / unlink identity - identity delete or audit insert failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
