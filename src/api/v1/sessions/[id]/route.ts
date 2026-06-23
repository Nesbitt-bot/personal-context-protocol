import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { sessions, topics } from '@/lib/schema';
import { logError } from '@/lib/logging';
import { eq } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    // Get session with topic info
    const [session] = await db
      .select({
        id: sessions.id,
        topicId: sessions.topicId,
        title: sessions.title,
        archived: sessions.archived,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
        lastMessageAt: sessions.lastMessageAt,
        topic_title: topics.title
      })
      .from(sessions)
      .leftJoin(topics, eq(sessions.topicId, topics.id))
      .where(eq(sessions.id, params.id));

    if (!session) {
      return NextResponse.json(
        {
          error: 'Unable to get session: session review / session lookup - session not found',
          code: 'NOT_FOUND'
        },
        { status: 404 }
      );
    }

    return NextResponse.json(session);
  } catch (error) {
    logError({
      consequence: 'Unable to get session',
      moduleProcess: 'session review / session detail query',
      cause: 'session and topic join query failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to get session: session review / session detail query - session and topic join query failed', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
