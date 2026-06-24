import { NextResponse, NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { messages, sessions, topics } from '@/lib/schema';
import { logError } from '@/lib/logging';
import { asc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * Public read-only view of a session: `GET /api/v1/public/sessions/<id>`. No
 * admin token required, but only when the session is marked public. A private or
 * missing session returns 404 so a private session's existence is not leaked.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const [session] = await db
      .select({
        id: sessions.id,
        title: sessions.title,
        public: sessions.public,
        archived: sessions.archived,
        createdAt: sessions.createdAt,
        lastMessageAt: sessions.lastMessageAt,
        topic_title: topics.title,
      })
      .from(sessions)
      .leftJoin(topics, eq(sessions.topicId, topics.id))
      .where(eq(sessions.id, params.id));

    if (!session || !session.public) {
      return NextResponse.json(
        { error: 'Unable to view session: public session view / visibility check - session is private or does not exist', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const sessionMessages = await db
      .select({
        id: messages.id,
        ordinal: messages.ordinal,
        role: messages.role,
        content: messages.content,
        provider: messages.provider,
        base_model: messages.BaseModel,
        observed_at: messages.observedAt,
      })
      .from(messages)
      .where(eq(messages.sessionId, params.id))
      .orderBy(asc(messages.ordinal));

    return NextResponse.json({
      session: {
        id: session.id,
        title: session.title,
        topic_title: session.topic_title,
        created_at: session.createdAt,
        last_message_at: session.lastMessageAt,
      },
      messages: sessionMessages,
    });
  } catch (error) {
    logError({
      consequence: 'Unable to view public session',
      moduleProcess: 'public session view / read query',
      cause: 'session lookup or message query failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to view public session: public session view / read query - session lookup or message query failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
