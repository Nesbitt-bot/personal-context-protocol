import { NextRequest, NextResponse } from 'next/server';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { sessionPresence, sessions } from '@/lib/schema';
import { verifyScopedToken } from '@/lib/middleware';

const report = z
  .object({
    reporter: z.enum(['codex', 'opencode']),
    run: z.string().uuid(),
    start: z.boolean(),
    state: z.enum(['synced', 'unsynced', 'closed']),
  })
  .strict();
export async function POST(request: NextRequest, { params }: { params: { key: string } }) {
  const auth = await verifyScopedToken(request);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const token = auth.token;
  if (!token.permissions.create_sessions || token.scope === 'session')
    return NextResponse.json({ error: 'Session writer required' }, { status: 403 });
  const data = report.safeParse(await request.json().catch(() => null));
  if (!data.success || (data.data.start && data.data.state === 'closed'))
    return NextResponse.json({ error: 'Invalid presence report' }, { status: 400 });
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.externalKey, params.key),
        token.scope === 'folder' ? eq(sessions.topicId, token.folderId ?? '') : undefined,
      ),
    )
    .limit(1);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  const { reporter, run: runId, state, start } = data.data;
  const set = { runId, state, seenAt: sql`now()` };
  if (start) {
    await db
      .insert(sessionPresence)
      .values({ sessionId: session.id, reporter, runId, state })
      .onConflictDoUpdate({
        target: [sessionPresence.sessionId, sessionPresence.reporter],
        set,
      });
  } else {
    // A delayed heartbeat or clean exit from a replaced worker must never
    // repaint a resumed session. A closed lease cannot be renewed.
    const updated = await db
      .update(sessionPresence)
      .set(set)
      .where(
        and(
          eq(sessionPresence.sessionId, session.id),
          eq(sessionPresence.reporter, reporter),
          eq(sessionPresence.runId, runId),
          ne(sessionPresence.state, 'closed'),
        ),
      )
      .returning({ id: sessionPresence.sessionId });
    if (!updated.length) return NextResponse.json({ error: 'Lease ended or replaced' }, { status: 409 });
  }
  return new NextResponse(null, { status: 204 });
}
