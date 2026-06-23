import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { topics } from '@/lib/schema';
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

    const [existing] = await db.select().from(topics).where(eq(topics.id, params.id));
    
    if (!existing) {
      return NextResponse.json(
        { error: 'Unable to archive topic: topic administration / topic lookup - topic not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    await db.update(topics).set({ archived: true, updatedAt: new Date() }).where(eq(topics.id, params.id));

    const { events } = await import('@/lib/schema');
    await db.insert(events).values({
      id: createId('evt'),
      topicId: params.id,
      action: 'topic.archived',
      actor: 'human',
      detailsJson: { title: existing.title },
      createdAt: new Date()
    });

    return NextResponse.json({ success: true, id: params.id, archived: true });
  } catch (error) {
    logError({
      consequence: 'Unable to archive topic',
      moduleProcess: 'topic administration / archive topic update',
      cause: 'topic lookup, archive update, or audit event insert failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to archive topic: topic administration / archive topic update - topic lookup, archive update, or audit event insert failed', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
