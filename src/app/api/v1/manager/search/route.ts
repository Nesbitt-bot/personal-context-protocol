import { NextResponse, NextRequest } from 'next/server';
import { and, desc, eq, ilike, inArray } from 'drizzle-orm';
import { verifyScopedToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { messages, sessions } from '@/lib/schema';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/** Escape LIKE wildcards so a user query is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Self-hosted retrieval (the "RAG" layer): `POST /api/v1/manager/search` with a
 * scoped token (requires read_all). Returns recent messages whose content
 * matches every query term, scoped to the token's folder/session. Zero external
 * cost — it uses Postgres ILIKE over the local message store.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyScopedToken(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }
    const tok = auth.token;
    if (!tok.permissions.read_all) {
      return NextResponse.json({ error: 'Unable to search: scoped token permissions / read_all check - token lacks read_all', code: 'FORBIDDEN' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const terms = query.split(/\s+/).filter(Boolean).slice(0, 6);
    if (terms.length === 0) {
      return NextResponse.json({ error: 'Unable to search: retrieval / query validation - query is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const limit = Math.min(50, Math.max(1, Number.isFinite(body.limit) ? Math.floor(body.limit) : 10));
    const sessionId = typeof body.session_id === 'string' && body.session_id ? body.session_id : null;

    const conditions = [];
    if (tok.scope === 'folder' && tok.folderId) conditions.push(eq(messages.topicId, tok.folderId));
    else if (tok.scope === 'session' && tok.sessionId) conditions.push(eq(messages.sessionId, tok.sessionId));
    if (sessionId) conditions.push(eq(messages.sessionId, sessionId));
    for (const term of terms) conditions.push(ilike(messages.content, `%${escapeLike(term)}%`));

    const rows = await db
      .select({
        id: messages.id,
        sessionId: messages.sessionId,
        role: messages.role,
        content: messages.content,
        ordinal: messages.ordinal,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    const sessionIds = [...new Set(rows.map((r) => r.sessionId))];
    const sessionRows = sessionIds.length
      ? await db.select({ id: sessions.id, title: sessions.title }).from(sessions).where(inArray(sessions.id, sessionIds))
      : [];
    const titleById = new Map(sessionRows.map((s) => [s.id, s.title]));

    return NextResponse.json({
      results: rows.map((r) => ({
        id: r.id,
        session_id: r.sessionId,
        session_title: titleById.get(r.sessionId) ?? null,
        role: r.role,
        content: r.content,
        ordinal: r.ordinal,
        created_at: r.createdAt,
      })),
    });
  } catch (error) {
    logError({ consequence: 'Unable to search', moduleProcess: 'scoped token manager / message retrieval', cause: 'message query failed', error });
    return NextResponse.json({ error: 'Unable to search: scoped token manager / message retrieval - message query failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
