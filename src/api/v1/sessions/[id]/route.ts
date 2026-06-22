import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { sessions, topics } from '@/lib/schema';
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
          error: 'Unable to get session: resource lookup — session not found',
          code: 'NOT_FOUND'
        },
        { status: 404 }
      );
    }

    return NextResponse.json(session);
  } catch (error) {
    console.error('Get session error:', error);
    return NextResponse.json(
      { error: 'Unable to get session: database query — internal error occurred', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
