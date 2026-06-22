import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { topics, sessions, events } from '@/lib/schema';
import { createId } from '@/lib/auth';
import { createSessionSchema } from '@/lib/validations';
import { eq } from 'drizzle-orm';

export async function POST(
  request: NextRequest,
  { params }: { params: { topicId: string } }
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
          error: 'Unable to create session: request validation — invalid request body',
          code: 'VALIDATION_ERROR',
          details: validation.error.errors
        },
        { status: 400 }
      );
    }

    const { title } = validation.data;

    // Verify topic exists
    const [topic] = await db.select().from(topics).where(eq(topics.id, params.topicId));
    
    if (!topic || topic.archived) {
      return NextResponse.json(
        {
          error: 'Unable to create session: resource lookup — topic not found',
          code: 'NOT_FOUND'
        },
        { status: 404 }
      );
    }

    const sessionId = createId('ses');
    
    await db.insert(sessions).values({
      id: sessionId,
      topicId: params.topicId,
      title,
      archived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastMessageAt: null
    });

    await db.insert(events).values({
      id: createId('evt'),
      sessionId: sessionId,
      topicId: params.topicId,
      action: 'session.created',
      actor: 'human',
      detailsJson: { title, session_id: sessionId },
      createdAt: new Date()
    });

    return NextResponse.json({
      success: true,
      id: sessionId,
      topic_id: params.topicId,
      title,
      archived: false,
      created_at: new Date().toISOString(),
      last_message_at: null
    });
  } catch (error) {
    console.error('Create session error:', error);
    return NextResponse.json(
      { error: 'Unable to create session: database transaction — internal error occurred', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
