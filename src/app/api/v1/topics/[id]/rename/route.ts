import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { topics, events } from '@/lib/schema';
import { renameTopicSchema } from '@/lib/validations';
import { createId } from '@/lib/auth';
import { logError } from '@/lib/logging';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';




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
    const validation = renameTopicSchema.safeParse(body);
    
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Unable to rename topic: topic administration / request validation - invalid request body',
          code: 'VALIDATION_ERROR',
          details: validation.error.errors
        },
        { status: 400 }
      );
    }

    const { title } = validation.data;

    // Check if topic exists
    const [existing] = await db.select().from(topics).where(eq(topics.id, params.id));
    
    if (!existing) {
      return NextResponse.json(
        {
          error: 'Unable to rename topic: topic administration / topic lookup - topic not found',
          code: 'NOT_FOUND'
        },
        { status: 404 }
      );
    }

    await db
      .update(topics)
      .set({ title, updatedAt: new Date() })
      .where(eq(topics.id, params.id));

    // Log event
    const eventsTable = (await import('@/lib/schema')).events;
    await db.insert(eventsTable).values({
      id: createId('evt'),
      topicId: params.id,
      action: 'topic.renamed',
      actor: 'human',
      detailsJson: { old_title: existing.title, new_title: title },
      createdAt: new Date()
    });

    return NextResponse.json({
      success: true,
      id: params.id,
      title
    });
  } catch (error) {
    logError({
      consequence: 'Unable to rename topic',
      moduleProcess: 'topic administration / rename topic update',
      cause: 'topic lookup, topic update, or audit event insert failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to rename topic: topic administration / rename topic update - topic lookup, topic update, or audit event insert failed', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
