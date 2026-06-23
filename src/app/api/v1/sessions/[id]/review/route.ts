import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { messages, sessions } from '@/lib/schema';
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
        { error: 'Unable to get messages: session review / session lookup - session not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const allMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, params.id));

    return NextResponse.json({ messages: allMessages });
  } catch (error) {
    logError({
      consequence: 'Unable to get messages',
      moduleProcess: 'session review / message list query',
      cause: 'session lookup or message query failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to get messages: session review / message list query - session lookup or message query failed', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
