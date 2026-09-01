import { NextResponse, NextRequest } from 'next/server';
import { verifyScopedToken } from '@/lib/middleware';
import { mintSessionTokenRecord } from '@/lib/manager-store';
import { sessionTopicId } from '@/lib/link-store';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

interface Params { id: string; }

/**
 * Mint a scoped recording token for an EXISTING session: `POST
 * /api/v1/manager/sessions/:id/tokens` with a scoped token that has
 * `mint_tokens` and covers the session. Complements the create+mint path in
 * `manager/sessions` so a worker can re-open a previously created session.
 */
export async function POST(request: NextRequest, { params }: { params: Params }) {
  try {
    const auth = await verifyScopedToken(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }
    const tok = auth.token;

    if (!tok.permissions.mint_tokens) {
      return NextResponse.json({ error: 'Unable to mint token: scoped token permissions / mint_tokens check - token lacks mint_tokens', code: 'FORBIDDEN' }, { status: 403 });
    }

    const topicId = await sessionTopicId(params.id);
    if (topicId === undefined) {
      return NextResponse.json({ error: 'Unable to mint token: scoped token manager / session lookup - session not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const covers = tok.scope === 'global'
      || (tok.scope === 'folder' && topicId === tok.folderId)
      || (tok.scope === 'session' && tok.sessionId === params.id);
    if (!covers) {
      return NextResponse.json({ error: 'Unable to mint token: scoped token permissions / scope check - session outside token scope', code: 'FORBIDDEN' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' && body.name ? body.name : 'manager';
    const minted = await mintSessionTokenRecord({ sessionId: params.id, name, canRename: true, expiresIn: 'never' });
    if (!minted) {
      return NextResponse.json({ error: 'Unable to mint token: scoped token manager / session lookup - session not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      session_id: params.id,
      access_token: minted.token,
      token_id: minted.tokenId,
      name: minted.name,
      expires_at: minted.expiresAt ? minted.expiresAt.toISOString() : null,
    });
  } catch (error) {
    logError({ consequence: 'Unable to mint token', moduleProcess: 'scoped token manager / mint token transaction', cause: 'permission check, session lookup, or token insert failed', error });
    return NextResponse.json({ error: 'Unable to mint token: scoped token manager / mint token transaction - internal error occurred', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
