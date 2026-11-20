import { NextRequest, NextResponse } from 'next/server';
import { and, inArray } from 'drizzle-orm';
import { authenticateUi, authErrorResponse } from '@/lib/ui-auth';
import { boundedText } from '@/lib/bounded-body';
import { db } from '@/lib/db';
import { sessions } from '@/lib/schema';
import { visibleSessionsFilter } from '@/lib/session-access';
import { searchSessions } from '@/lib/session-search';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const auth = await authenticateUi(request);
  if ('error' in auth) return authErrorResponse(auth);
  const body = await boundedText(request, 8192).then(text => JSON.parse(text)).catch(() => null);
  const q = typeof body?.q === 'string' ? body.q.trim() : '';
  if (!q || q.length > 500) return NextResponse.json({ error: 'Enter a query between 1 and 500 characters.' }, { status: 400 });
  try {
    const visible = visibleSessionsFilter(auth.actor);
    const allowed = visible ? (await db.select({ id: sessions.id }).from(sessions).where(visible)).map(row => row.id) : undefined;
    const { ids, semantic } = await searchSessions(q, allowed);
    // Final authorization and display data both come from PostgreSQL, not a stale index.
    const rows = ids.length ? await db.select({ id: sessions.id, title: sessions.title }).from(sessions)
      .where(and(visible, inArray(sessions.id, ids))) : [];
    const byId = new Map(rows.map(row => [row.id, row]));
    const results = ids.flatMap(id => byId.get(id) ?? []).slice(0, 20);
    return NextResponse.json({ results, semantic }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Session search is unavailable. Try again shortly.' }, { status: 503 });
  }
}
