import { NextResponse, NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { verifyScopedToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { topics } from '@/lib/schema';
import { logError } from '@/lib/logging';
import { createSessionRecord, mintSessionTokenRecord } from '@/lib/manager-store';
import { buildRecordingUrl, resolveAppBaseUrl } from '@/lib/recording-url';

export const dynamic = 'force-dynamic';

/**
 * Scoped-token session creation: `POST /api/v1/manager/sessions` with
 * Authorization: Bearer <scoped-token>. Requires `create_sessions`; when
 * `mint_tokens` is granted it also mints a never-expiring session token and
 * returns it. A folder-scoped token is forced into its own folder.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyScopedToken(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }
    const tok = auth.token;

    if (!tok.permissions.create_sessions) {
      return NextResponse.json(
        { error: 'Unable to create session: scoped token permissions / create_sessions check - token lacks create_sessions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined;
    const mode: 'wild' | 'exact' = body.mode === 'exact' ? 'exact' : 'wild';

    let folderId: string | null = null;
    if (tok.scope === 'folder') {
      folderId = tok.folderId;
    } else if (tok.scope === 'global') {
      if (typeof body.folder_id === 'string' && body.folder_id) {
        const [folder] = await db
          .select({ id: topics.id, archived: topics.archived })
          .from(topics)
          .where(eq(topics.id, body.folder_id));
        if (!folder || folder.archived) {
          return NextResponse.json(
            { error: 'Unable to create session: scoped token permissions / folder lookup - folder not found or archived', code: 'NOT_FOUND' },
            { status: 404 },
          );
        }
        folderId = body.folder_id;
      }
    } else {
      return NextResponse.json(
        { error: 'Unable to create session: scoped token permissions / scope check - session-scoped token cannot create sessions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const { sessionId, title: finalTitle } = await createSessionRecord({ topicId: folderId, title, mode });

    let accessToken: string | null = null;
    if (tok.permissions.mint_tokens) {
      const minted = await mintSessionTokenRecord({ sessionId, name: 'manager', canRename: true, expiresIn: 'never' });
      if (minted) accessToken = minted.token;
    }

    const baseUrl = resolveAppBaseUrl(request.nextUrl.origin);

    return NextResponse.json({
      success: true,
      session_id: sessionId,
      title: finalTitle,
      folder_id: folderId,
      mode,
      access_token: accessToken,
      recording_url: buildRecordingUrl(baseUrl, sessionId),
    });
  } catch (error) {
    logError({
      consequence: 'Unable to create session',
      moduleProcess: 'scoped token manager / create session transaction',
      cause: 'permission check, folder lookup, session insert, token mint, or audit event insert failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to create session: scoped token manager / create session transaction - internal error occurred', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
