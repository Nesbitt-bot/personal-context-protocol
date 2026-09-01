import { NextResponse, NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { verifyScopedToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { topics, sessions } from '@/lib/schema';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Scoped folder/session tree: `GET /api/v1/manager/tree` with a scoped token.
 * Requires `read_all`. A global token sees every folder and session; a folder
 * token sees only its own folder; a session token sees only its own session.
 * Used by the global token manager UI (file-tree scope selector) and by the DSH
 * worker to route recording to a session.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyScopedToken(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }
    const tok = auth.token;

    if (!tok.permissions.read_all) {
      return NextResponse.json(
        { error: 'Unable to read tree: scoped token permissions / read_all check - token lacks read_all', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const folderRows = await db
      .select({ id: topics.id, title: topics.title, archived: topics.archived })
      .from(topics)
      .orderBy(topics.createdAt);

    const sessionRows = await db
      .select({
        id: sessions.id,
        topic_id: sessions.topicId,
        title: sessions.title,
        archived: sessions.archived,
        last_message_at: sessions.lastMessageAt,
      })
      .from(sessions)
      .orderBy(sessions.lastMessageAt);

    const visibleFolders = tok.scope === 'folder' && tok.folderId
      ? folderRows.filter((f) => f.id === tok.folderId)
      : tok.scope === 'session'
        ? []
        : folderRows;

    let visibleSessions = sessionRows;
    if (tok.scope === 'folder') {
      visibleSessions = sessionRows.filter((s) => s.topic_id === tok.folderId);
    } else if (tok.scope === 'session') {
      visibleSessions = sessionRows.filter((s) => s.id === tok.sessionId);
    }

    const folders = visibleFolders
      .filter((f) => !f.archived)
      .map((f) => ({
        id: f.id,
        title: f.title,
        sessions: visibleSessions
          .filter((s) => s.topic_id === f.id && !s.archived)
          .map((s) => ({ id: s.id, title: s.title, last_message_at: s.last_message_at })),
      }));

    const uncategorized = visibleSessions
      .filter((s) => s.topic_id == null && !s.archived)
      .map((s) => ({ id: s.id, title: s.title, last_message_at: s.last_message_at }));

    return NextResponse.json({ folders, uncategorized });
  } catch (error) {
    logError({
      consequence: 'Unable to read tree',
      moduleProcess: 'scoped token manager / tree query',
      cause: 'folder or session query failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to read tree: scoped token manager / tree query - folder or session query failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
