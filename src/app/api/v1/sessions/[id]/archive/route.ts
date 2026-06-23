import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { sessions } from '@/lib/schema';
import { createId } from '@/lib/auth';
import { logError } from '@/lib/logging';
import { eq, sql } from 'drizzle-orm';

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

    const [existing] = await db.select().from(sessions).where(eq(sessions.id, params.id));
    
    if (!existing) {
      return NextResponse.json(
        { error: 'Unable to archive session: session administration / session lookup - session not found', code: 'NOT_FOUND' },
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
    logError({
      consequence: 'Unable to archive session',
      moduleProcess: 'session administration / archive session update',
      cause: 'session lookup, archive update, or audit event insert failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to archive session: session administration / archive session update - session lookup, archive update, or audit event insert failed', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
