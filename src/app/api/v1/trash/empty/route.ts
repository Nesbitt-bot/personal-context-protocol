import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { compactions, events, messages, sessionTokens, sessions, topics } from '@/lib/schema';
import { createId } from '@/lib/auth';
import { logError } from '@/lib/logging';
import { eq, inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/** Permanently delete ALL archived topics and sessions. UI token only. */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const archivedSessions = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.archived, true));
    const archivedTopics = await db.select({ id: topics.id }).from(topics).where(eq(topics.archived, true));
    const sessionIds = archivedSessions.map((s) => s.id);
    const topicIds = archivedTopics.map((t) => t.id);

    if (sessionIds.length > 0) {
      // Move topic sessions to uncategorized, then delete.
      if (topicIds.length > 0) {
        await db.update(sessions).set({ topicId: null }).where(inArray(sessions.topicId, topicIds));
      }

      // Delete child rows, then sessions.
      await db.delete(messages).where(inArray(messages.sessionId, sessionIds));
      await db.delete(compactions).where(inArray(compactions.sessionId, sessionIds));
      await db.delete(sessionTokens).where(inArray(sessionTokens.sessionId, sessionIds));
      await db.delete(events).where(inArray(events.sessionId, sessionIds));
      await db.delete(sessions).where(inArray(sessions.id, sessionIds));
    }
    if (topicIds.length > 0) {
      await db.delete(topics).where(inArray(topics.id, topicIds));
    }

    await db.insert(events).values({
      id: createId('evt'),
      action: 'trash.emptied',
      actor: 'human',
      detailsJson: { sessions_deleted: sessionIds.length, topics_deleted: topicIds.length },
      createdAt: new Date(),
    });

    return NextResponse.json({ success: true, sessions_deleted: sessionIds.length, topics_deleted: topicIds.length });
  } catch (error) {
    logError({ consequence: 'Unable to empty trash', moduleProcess: 'trash administration / empty trash transaction', cause: 'archived session or topic deletion failed', error });
    return NextResponse.json({ error: 'Unable to empty trash: trash administration / empty trash transaction', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
