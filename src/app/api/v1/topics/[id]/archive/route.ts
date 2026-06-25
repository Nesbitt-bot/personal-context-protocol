import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { events, sessions, topics } from '@/lib/schema';
import { createId } from '@/lib/auth';
import { logError } from '@/lib/logging';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/** Archive a topic (soft delete — moves to Trash). */
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
      return NextResponse.json({ error: 'Unable to archive topic: topic administration / topic lookup - topic not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Accept `{ "archived": false }` to restore from trash.
    const body = await request.json().catch(() => ({}));
    const targetArchived = body.archived === false ? false : true;

    await db.update(topics).set({ archived: targetArchived, updatedAt: new Date() }).where(eq(topics.id, params.id));

    await db.insert(events).values({
      id: createId('evt'), topicId: params.id,
      action: targetArchived ? 'topic.archived' : 'topic.restored', actor: 'human',
      detailsJson: { title: existing.title }, createdAt: new Date()
    });

    return NextResponse.json({ success: true, id: params.id, archived: targetArchived });
  } catch (error) {
    logError({ consequence: 'Unable to archive topic', moduleProcess: 'topic administration / archive topic update', cause: 'topic lookup, archive update, or audit event insert failed', error });
    return NextResponse.json({ error: 'Unable to archive topic: topic administration / archive topic update', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/** Permanently delete a topic (from Trash). Moves its sessions to Uncategorized first. */
export async function DELETE(
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
      return NextResponse.json({ error: 'Unable to delete topic: topic administration / topic lookup - topic not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Move sessions to Uncategorized before deleting the topic.
    await db.update(sessions).set({ topicId: null, updatedAt: new Date() }).where(eq(sessions.topicId, params.id));
    await db.delete(topics).where(eq(topics.id, params.id));

    await db.insert(events).values({
      id: createId('evt'), topicId: null, action: 'topic.deleted', actor: 'human',
      detailsJson: { topic_id: params.id, title: existing.title }, createdAt: new Date()
    });

    return NextResponse.json({ success: true, id: params.id, deleted: true });
  } catch (error) {
    logError({ consequence: 'Unable to delete topic', moduleProcess: 'topic administration / permanent delete', cause: 'topic lookup, session reassignment, or topic deletion failed', error });
    return NextResponse.json({ error: 'Unable to delete topic: topic administration / permanent delete', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
