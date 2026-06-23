import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { topics, sessions, events } from '@/lib/schema';
import { createId } from '@/lib/auth';
import { logError } from '@/lib/logging';
import { createTopicSchema } from '@/lib/validations';
import { eq, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const allTopics = await db.select().from(topics).orderBy(topics.createdAt);
    
    // Add session count to each topic
    const topicsWithCount = await Promise.all(
      allTopics.map(async (topic) => {
        const [result] = await db
          .select({ count: sql<number>`count(${sessions.id})` })
          .from(sessions)
          .where(eq(sessions.topicId, topic.id));
        const count = result?.count ? Number(result.count) : 0;
        return { ...topic, session_count: count };
      })
    );

    return NextResponse.json({ topics: topicsWithCount });
  } catch (error) {
    logError({
      consequence: 'Unable to list topics',
      moduleProcess: 'topic administration / topic list query',
      cause: 'topic or session count query failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to list topics: topic administration / topic list query - topic or session count query failed', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const body = await request.json();
    const validation = createTopicSchema.safeParse(body);
    
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Unable to create topic: topic administration / request validation - invalid request body',
          code: 'VALIDATION_ERROR',
          details: validation.error.errors
        },
        { status: 400 }
      );
    }

    const { title, description } = validation.data;

    // Check for duplicate title
    const [existing] = await db
      .select()
      .from(topics)
      .where(eq(topics.title, title));
    
    if (existing && !existing.archived) {
      return NextResponse.json(
        {
          error: 'Unable to create topic: topic administration / duplicate title validation - topic title already exists',
          code: 'VALIDATION_ERROR'
        },
        { status: 400 }
      );
    }

    const topicId = createId('topic');
    
    await db.insert(topics).values({
      id: topicId,
      title,
      description: description || null,
      archived: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await db.insert(events).values({
      id: createId('evt'),
      topicId: topicId,
      action: 'topic.created',
      actor: 'human',
      detailsJson: { title, topic_id: topicId },
      createdAt: new Date()
    });

    return NextResponse.json({
      success: true,
      id: topicId,
      title,
      description: description || null,
      archived: false,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    logError({
      consequence: 'Unable to create topic',
      moduleProcess: 'topic administration / create topic transaction',
      cause: 'duplicate lookup, topic insert, or audit event insert failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to create topic: topic administration / create topic transaction - duplicate lookup, topic insert, or audit event insert failed', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
