import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { messages, sessions } from '@/lib/schema';
import { eq } from 'drizzle-orm';

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
        { error: 'Unable to get messages: resource lookup — session not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const allMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, params.id));

    return NextResponse.json({ messages: allMessages });
  } catch (error) {
    console.error('Get messages error:', error);
    return NextResponse.json(
      { error: 'Unable to get messages: database query — internal error occurred', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
