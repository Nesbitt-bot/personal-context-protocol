import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { events, sessions } from '@/lib/schema';
import { logError } from '@/lib/logging';
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

    // Verify session exists
    const [session] = await db.select().from(sessions).where(eq(sessions.id, params.id));
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unable to get events: session review / session lookup - session not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const allEvents = await db
      .select()
      .from(events)
      .where(eq(events.sessionId, params.id));

    return NextResponse.json({ events: allEvents });
  } catch (error) {
    logError({
      consequence: 'Unable to get events',
      moduleProcess: 'session review / event list query',
      cause: 'session lookup or event query failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to get events: session review / event list query - session lookup or event query failed', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
