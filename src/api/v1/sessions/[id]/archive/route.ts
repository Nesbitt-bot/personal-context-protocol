import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { sessions } from '@/lib/schema';
import { createId } from '@/lib/auth';
import { eq, sql } from 'drizzle-orm';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const [existing] = await db.select().from(sessions).where(eq(sessions.id, params.id));
    
    if (!existing) {
      return NextResponse.json(
        { error: 'Unable to archive session: resource lookup — session not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    await db.update(sessions).set({ archived: true, updatedAt: new Date() }).where(eq(sessions.id, params.id));

    const { events } = await import('@/lib/schema');
    await db.insert(events).values({
      id: createId('evt'),
      sessionId: params.id,
      action: 'session.archived',
      actor: 'human',
      detailsJson: { title: existing.title },
      createdAt: new Date()
    });

    return NextResponse.json({ success: true, id: params.id, archived: true });
  } catch (error) {
    console.error('Archive session error:', error);
    return NextResponse.json(
      { error: 'Unable to archive session: database update — internal error occurred', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
