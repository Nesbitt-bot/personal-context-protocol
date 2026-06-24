import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { topics, sessions, events } from '@/lib/schema';
import { createId } from '@/lib/auth';
import { logError } from '@/lib/logging';
import { createSessionSchema } from '@/lib/validations';
import { uniqueSessionTitle } from '@/lib/session-store';
import { desc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/** List every session (admin), including uncategorized ones (topic_id null). */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const allSessions = await db
      .select({
        id: sessions.id,
        topic_id: sessions.topicId,
        title: sessions.title,
        archived: sessions.archived,
        created_at: sessions.createdAt,
        updated_at: sessions.updatedAt,
        last_message_at: sessions.lastMessageAt,
      })
      .from(sessions)
      .orderBy(desc(sessions.lastMessageAt), desc(sessions.createdAt));

    return NextResponse.json({ sessions: allSessions });
  } catch (error) {
    logError({
      consequence: 'Unable to list sessions',
      moduleProcess: 'session administration / list all sessions query',
      cause: 'session list query failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to list sessions: session administration / list all sessions query - session list query failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

/** Create a session, optionally under a topic. Omit topic_id for uncategorized. */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const body = await request.json().catch(() => ({}));
    const validation = createSessionSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Unable to create session: session administration / request validation - invalid request body',
          code: 'VALIDATION_ERROR',
          details: validation.error.errors,
        },
        { status: 400 },
      );
    }

    const topicId = validation.data.topic_id ?? null;

    if (topicId) {
      const [topic] = await db.select({ id: topics.id, archived: topics.archived }).from(topics).where(eq(topics.id, topicId));
      if (!topic || topic.archived) {
        return NextResponse.json(
          { error: 'Unable to create session: session administration / topic lookup - topic not found or archived', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }
    }

    const title = await uniqueSessionTitle(topicId, validation.data.title);
    const sessionId = createId('ses');

    await db.insert(sessions).values({
      id: sessionId,
      topicId,
      title,
      archived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastMessageAt: null,
    });

    await db.insert(events).values({
      id: createId('evt'),
      sessionId,
      topicId,
      action: 'session.created',
      actor: 'human',
      detailsJson: { title, session_id: sessionId, topic_id: topicId },
      createdAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      id: sessionId,
      topic_id: topicId,
      title,
      archived: false,
      created_at: new Date().toISOString(),
      last_message_at: null,
    });
  } catch (error) {
    logError({
      consequence: 'Unable to create session',
      moduleProcess: 'session administration / create session transaction',
      cause: 'topic lookup, session insert, or audit event insert failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to create session: session administration / create session transaction - topic lookup, session insert, or audit event insert failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
