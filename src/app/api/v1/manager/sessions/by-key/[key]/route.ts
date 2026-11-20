import { NextResponse, NextRequest } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { verifyScopedToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { importReceipts, messages, sessions } from '@/lib/schema';
import { logError } from '@/lib/logging';
import { normalizeExternalKey } from '@/lib/external-key';

export const dynamic = 'force-dynamic';

/**
 * Resolve an external session key: `GET /api/v1/manager/sessions/by-key/<key>`
 * with a scoped token (requires `read_all`).
 *
 * This is the cursor probe a sync worker uses before uploading: it reports how
 * many messages PCP already holds for that source transcript, so the worker can
 * resume rather than re-send. A key outside the token's scope reports `found:
 * false` rather than 403, so the boundary cannot be used to test for the
 * existence of sessions the token may not read.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { key: string } },
) {
  try {
    const auth = await verifyScopedToken(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }
    const tok = auth.token;

    if (!tok.permissions.read_all) {
      return NextResponse.json(
        { error: 'Unable to resolve session: scoped token permissions / read_all check - token lacks read_all', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    let externalKey: string | null;
    try {
      externalKey = normalizeExternalKey(decodeURIComponent(params.key));
    } catch (error) {
      return NextResponse.json(
        {
          error: `Unable to resolve session: scoped token manager / external key validation - ${error instanceof Error ? error.message : 'invalid external key'}`,
          code: 'VALIDATION_ERROR',
        },
        { status: 400 },
      );
    }

    const [session] = await db
      .select({ id: sessions.id, topicId: sessions.topicId, title: sessions.title, mode: sessions.mode })
      .from(sessions)
      .where(eq(sessions.externalKey, externalKey!));

    const outOfScope =
      !session ||
      (tok.scope === 'folder' && session.topicId !== tok.folderId) ||
      (tok.scope === 'session' && session.id !== tok.sessionId);
    if (outOfScope) {
      return NextResponse.json({ found: false, external_key: externalKey });
    }

    // Legacy clients slice the source transcript at message_count. A physically
    // removed mirror turn still consumes its original position in that stream.
    const [cursor] = await db.select({
      visible: sql<number>`count(*)::int`,
      removed: sql<number>`(select count(*)::int from ${importReceipts} where session_id = ${session.id} and removed)`,
      last: sql<number>`greatest(coalesce(max(${messages.ordinal}), 0), (select coalesce(max(ordinal), 0) from ${importReceipts} where session_id = ${session.id}))`,
    }).from(messages).where(eq(messages.sessionId, session.id));
    const messageCount = Number(cursor.visible) + Number(cursor.removed);

    return NextResponse.json({
      found: true,
      external_key: externalKey,
      session_id: session.id,
      title: session.title,
      mode: session.mode,
      message_count: messageCount,
      visible_message_count: Number(cursor.visible),
      last_ordinal: Number(cursor.last),
    });
  } catch (error) {
    logError({
      consequence: 'Unable to resolve session',
      moduleProcess: 'scoped token manager / external session lookup',
      cause: 'token verification, external key validation, or session lookup failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to resolve session: scoped token manager / external session lookup - internal error occurred', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
