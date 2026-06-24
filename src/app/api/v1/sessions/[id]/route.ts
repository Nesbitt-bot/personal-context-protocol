import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { events, sessions, topics } from '@/lib/schema';
import { logError } from '@/lib/logging';
import { createId } from '@/lib/auth';
import { updateSessionSchema } from '@/lib/validations';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';




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
        public: sessions.public,
        mode: sessions.mode,
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const body = await request.json();
    const validation = updateSessionSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Unable to update session: session administration / request validation - invalid request body',
          code: 'VALIDATION_ERROR',
          details: validation.error.errors,
        },
        { status: 400 },
      );
    }

    const [existing] = await db.select().from(sessions).where(eq(sessions.id, params.id));

    if (!existing) {
      return NextResponse.json(
        { error: 'Unable to update session: session administration / session lookup - session not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const { title, topic_id, archived, public: isPublic, mode } = validation.data;

    if (topic_id) {
      const [targetTopic] = await db.select().from(topics).where(eq(topics.id, topic_id));
      if (!targetTopic || targetTopic.archived) {
        return NextResponse.json(
          { error: 'Unable to update session: session administration / target topic lookup - topic not found or archived', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }
    }

    const updates = {
      ...(title !== undefined ? { title } : {}),
      ...(topic_id !== undefined ? { topicId: topic_id } : {}),
      ...(archived !== undefined ? { archived } : {}),
      ...(isPublic !== undefined ? { public: isPublic } : {}),
      ...(mode !== undefined ? { mode } : {}),
      updatedAt: new Date(),
    };

    await db.update(sessions).set(updates).where(eq(sessions.id, params.id));

    // topic_id may be null (move to uncategorized); distinguish "unset" (undefined).
    const nextTopicId = topic_id === undefined ? existing.topicId : topic_id;

    await db.insert(events).values({
      id: createId('evt'),
      sessionId: params.id,
      topicId: nextTopicId ?? existing.topicId,
      action: archived === true ? 'session.archived' : archived === false ? 'session.restored'
        : isPublic === true ? 'session.shared' : isPublic === false ? 'session.unshared' : 'session.updated',
      actor: 'human',
      detailsJson: {
        old_title: existing.title,
        new_title: title ?? existing.title,
        old_topic_id: existing.topicId,
        new_topic_id: nextTopicId,
        archived: archived ?? existing.archived,
        public: isPublic ?? existing.public,
        mode: mode ?? existing.mode,
      },
      createdAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      id: params.id,
      title: title ?? existing.title,
      topic_id: nextTopicId,
      archived: archived ?? existing.archived,
      public: isPublic ?? existing.public,
      mode: mode ?? existing.mode,
    });
  } catch (error) {
    logError({
      consequence: 'Unable to update session',
      moduleProcess: 'session administration / update session transaction',
      cause: 'session lookup, target topic lookup, session update, or audit event insert failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to update session: session administration / update session transaction - session lookup, target topic lookup, session update, or audit event insert failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
