import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { events, messages, sessionTokens, compactions, sessions, topics } from '@/lib/schema';
import { logError } from '@/lib/logging';
import { createId } from '@/lib/auth';
import { updateSessionSchema } from '@/lib/validations';
import { eq, inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

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
      return NextResponse.json({ error: 'Unable to get session: session review / session lookup - session not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json(session);
  } catch (error) {
    logError({ consequence: 'Unable to get session', moduleProcess: 'session review / session detail query', cause: 'session and topic join query failed', error });
    return NextResponse.json({ error: 'Unable to get session: session review / session detail query - session and topic join query failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const body = await request.json();
    const validation = updateSessionSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: 'Unable to update session: session administration / request validation - invalid request body', code: 'VALIDATION_ERROR', details: validation.error.errors }, { status: 400 });
    }

    const [existing] = await db.select().from(sessions).where(eq(sessions.id, params.id));
    if (!existing) {
      return NextResponse.json({ error: 'Unable to update session: session administration / session lookup - session not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const { title, topic_id, archived, public: isPublic, mode } = validation.data;

    if (topic_id) {
      const [targetTopic] = await db.select().from(topics).where(eq(topics.id, topic_id));
      if (!targetTopic || targetTopic.archived) {
        return NextResponse.json({ error: 'Unable to update session: session administration / target topic lookup - topic not found or archived', code: 'NOT_FOUND' }, { status: 404 });
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

    const nextTopicId = topic_id === undefined ? existing.topicId : topic_id;

    await db.insert(events).values({
      id: createId('evt'),
      sessionId: params.id,
      topicId: nextTopicId ?? existing.topicId,
      action: archived === true ? 'session.archived' : archived === false ? 'session.restored'
        : isPublic === true ? 'session.shared' : isPublic === false ? 'session.unshared' : 'session.updated',
      actor: 'human',
      detailsJson: { old_title: existing.title, new_title: title ?? existing.title, old_topic_id: existing.topicId, new_topic_id: nextTopicId, archived: archived ?? existing.archived, public: isPublic ?? existing.public, mode: mode ?? existing.mode },
      createdAt: new Date(),
    });

    return NextResponse.json({
      success: true, id: params.id, title: title ?? existing.title,
      topic_id: nextTopicId, archived: archived ?? existing.archived, public: isPublic ?? existing.public, mode: mode ?? existing.mode,
    });
  } catch (error) {
    logError({ consequence: 'Unable to update session', moduleProcess: 'session administration / update session transaction', cause: 'session lookup, update, or audit event insert failed', error });
    return NextResponse.json({ error: 'Unable to update session: session administration / update session transaction - session lookup, update, or audit event insert failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/** Permanent delete of a session and all its child data. UI-token only. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const [existing] = await db.select({ id: sessions.id, title: sessions.title }).from(sessions).where(eq(sessions.id, params.id));
    if (!existing) {
      return NextResponse.json({ error: 'Unable to delete session: session administration / session lookup - session not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Delete child rows first (cascading manually for safety).
    const msgIds = await db.select({ id: messages.id }).from(messages).where(eq(messages.sessionId, params.id));
    if (msgIds.length > 0) {
      await db.delete(messages).where(eq(messages.sessionId, params.id));
    }
    await db.delete(sessionTokens).where(eq(sessionTokens.sessionId, params.id));
    await db.delete(compactions).where(eq(compactions.sessionId, params.id));
    await db.delete(events).where(eq(events.sessionId, params.id));
    await db.delete(sessions).where(eq(sessions.id, params.id));

    // Audit: log to the session's topic (or null) since the session itself is gone.
    await db.insert(events).values({
      id: createId('evt'),
      sessionId: null,
      action: 'session.deleted',
      actor: 'human',
      detailsJson: { session_id: params.id, title: existing.title, message_count: msgIds.length },
      createdAt: new Date(),
    });

    return NextResponse.json({ success: true, id: params.id, deleted: true });
  } catch (error) {
    logError({ consequence: 'Unable to delete session', moduleProcess: 'session administration / permanent delete', cause: 'session or child data deletion failed', error });
    return NextResponse.json({ error: 'Unable to delete session: session administration / permanent delete - session or child data deletion failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
