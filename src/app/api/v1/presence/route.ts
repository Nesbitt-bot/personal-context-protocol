import { NextRequest, NextResponse } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';
import { authenticateUi, authErrorResponse } from '@/lib/ui-auth';
import { visibleSessionsFilter } from '@/lib/session-access';
import { db } from '@/lib/db';
import { sessionPresence, sessions, tasks } from '@/lib/schema';
import { presenceLights } from '@/lib/presence';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const auth = await authenticateUi(request);
  if ('error' in auth) return authErrorResponse(auth);
  const rows = await db
    .select({
      id: sessions.id,
      taskId: sessions.taskId,
      state: sessionPresence.state,
      seenAt: sessionPresence.seenAt,
    })
    .from(sessionPresence)
    .innerJoin(sessions, eq(sessions.id, sessionPresence.sessionId))
    .where(and(visibleSessionsFilter(auth.actor), ne(sessionPresence.state, 'closed')));
  // The task board is admin-only. Never disclose its hierarchy to members.
  const parents =
    rows.length && auth.actor.isAdmin
      ? await db.select({ id: tasks.id, parentId: tasks.parentId }).from(tasks)
      : [];
  return NextResponse.json(presenceLights(rows, parents, Date.now()), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
