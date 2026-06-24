import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { topics, sessions, events } from '@/lib/schema';
import { createId } from '@/lib/auth';
import { logError } from '@/lib/logging';
import { createSessionSchema } from '@/lib/validations';
import { DEFAULT_SESSION_TITLE, generateUniqueTitle } from '@/lib/naming';
import { desc, eq } from 'drizzle-orm';

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

    const [topic] = await db.select().from(topics).where(eq(topics.id, params.id));

    if (!topic) {
      return NextResponse.json(
        {
          error: 'Unable to list sessions: session administration / topic lookup - topic not found',
          code: 'NOT_FOUND',
        },
        { status: 404 },
      );
    }

    const topicSessions = await db
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
      .where(eq(sessions.topicId, params.id))
      .orderBy(desc(sessions.lastMessageAt), desc(sessions.createdAt));

    return NextResponse.json({ sessions: topicSessions });
  } catch (error) {
    logError({
      consequence: 'Unable to list sessions',
      moduleProcess: 'session administration / list sessions query',
      cause: 'topic lookup or session list query failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to list sessions: session administration / list sessions query - topic lookup or session list query failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const body = await request.json();
    const validation = createSessionSchema.safeParse(body);
    
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Unable to create session: session administration / request validation - invalid request body',
          code: 'VALIDATION_ERROR',
          details: validation.error.errors
        },
        { status: 400 }
      );
    }

    // Verify topic exists
    const [topic] = await db.select().from(topics).where(eq(topics.id, params.id));

    if (!topic || topic.archived) {
      return NextResponse.json(
        {
          error: 'Unable to create session: session administration / topic lookup - topic not found',
          code: 'NOT_FOUND'
        },
        { status: 404 }
      );
    }

    // Auto-name and auto-suffix within the topic so "New Session" works one-click.
    const siblings = await db
      .select({ title: sessions.title })
      .from(sessions)
      .where(eq(sessions.topicId, params.id));
    const title = generateUniqueTitle(
      validation.data.title,
      siblings.map((session) => session.title),
      DEFAULT_SESSION_TITLE,
    );

    const sessionId = createId('ses');
    
    await db.insert(sessions).values({
      id: sessionId,
      topicId: params.id,
      title,
      archived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastMessageAt: null
    });

    await db.insert(events).values({
      id: createId('evt'),
      sessionId: sessionId,
      topicId: params.id,
      action: 'session.created',
      actor: 'human',
      detailsJson: { title, session_id: sessionId },
      createdAt: new Date()
    });

    return NextResponse.json({
      success: true,
      id: sessionId,
      topic_id: params.id,
      title,
      archived: false,
      created_at: new Date().toISOString(),
      last_message_at: null
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
      { status: 500 }
    );
  }
}
