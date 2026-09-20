import { NextResponse, NextRequest } from 'next/server';
import { count, eq } from 'drizzle-orm';
import { verifyScopedToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { messages, sessions } from '@/lib/schema';
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

    const [cursor] = await db
      .select({ messageCount: count(messages.id) })
      .from(messages)
      .where(eq(messages.sessionId, session.id));

    // Ordinals are assigned monotonically from 1 per session, so the message
    // count is also the highest ordinal recorded.
    const messageCount = Number(cursor?.messageCount ?? 0);

    return NextResponse.json({
      found: true,
      external_key: externalKey,
      session_id: session.id,
      title: session.title,
      mode: session.mode,
      message_count: messageCount,
      last_ordinal: messageCount,
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
