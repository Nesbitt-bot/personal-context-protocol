import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { sessions, topics, messages, sessionTokens, events, uiAuth, appInstance } from '@/lib/schema';
import { logError } from '@/lib/logging';
import { eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    // Export all data
    const instance = await db.select().from(appInstance);
    const allTopics = await db.select().from(topics);
    const allSessions = await db.select().from(sessions);
    const allMessages = await db.select().from(messages);
    const allTokens = await db.select({ 
      id: sessionTokens.id, 
      sessionId: sessionTokens.sessionId, 
      name: sessionTokens.name, 
      canRenameSession: sessionTokens.canRenameSession,
      revoked: sessionTokens.revoked,
      createdAt: sessionTokens.createdAt,
      expiresAt: sessionTokens.expiresAt,
      lastUsedAt: sessionTokens.lastUsedAt
    }).from(sessionTokens);
    const allEvents = await db.select().from(events);

    return NextResponse.json({
      export_version: '0.1',
      exported_at: new Date().toISOString(),
      app_instance: instance[0],
      topics: allTopics,
      sessions: allSessions,
      messages: allMessages,
      session_tokens: allTokens,
      events: allEvents
    });
  } catch (error) {
    logError({
      consequence: 'Unable to export data',
      moduleProcess: 'data export / full database export query',
      cause: 'one or more export table queries failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to export data: data export / full database export query - one or more export table queries failed', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
