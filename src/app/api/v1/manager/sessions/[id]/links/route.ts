import { NextResponse, NextRequest } from 'next/server';
import { verifyScopedToken } from '@/lib/middleware';
import { createSessionLink, deleteSessionLink, listSessionLinks, sessionTopicId } from '@/lib/link-store';
import { createSessionLinkSchema } from '@/lib/validations';
import { logError } from '@/lib/logging';
import type { ResolvedScopedToken } from '@/lib/scoped-token';

export const dynamic = 'force-dynamic';

interface Params { id: string; }

function tokenCovers(tok: ResolvedScopedToken, topicId: string | null): boolean {
  if (tok.scope === 'global') return true;
  if (tok.scope === 'folder') return topicId === tok.folderId;
  return tok.scope === 'session' && topicId != null && tok.sessionId != null;
}

/** List links for a session the scoped token can read. */
export async function GET(request: NextRequest, { params }: { params: Params }) {
  try {
    const auth = await verifyScopedToken(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }
    const tok = auth.token;
    if (!tok.permissions.read_all) {
      return NextResponse.json({ error: 'Unable to list links: scoped token permissions / read_all check - token lacks read_all', code: 'FORBIDDEN' }, { status: 403 });
    }
    const topicId = await sessionTopicId(params.id);
    if (topicId === undefined) {
      return NextResponse.json({ error: 'Unable to list links: session link administration / session lookup - session not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    if (!tokenCovers(tok, topicId)) {
      return NextResponse.json({ error: 'Unable to list links: scoped token permissions / scope check - session outside token scope', code: 'FORBIDDEN' }, { status: 403 });
    }

    const links = await listSessionLinks(params.id);
    return NextResponse.json({ links });
  } catch (error) {
    logError({ consequence: 'Unable to list links', moduleProcess: 'scoped token manager / link list query', cause: 'link query failed', error });
    return NextResponse.json({ error: 'Unable to list links: scoped token manager / link list query - link query failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/** Create a link between two sessions within the token's scope. */
export async function POST(request: NextRequest, { params }: { params: Params }) {
  try {
    const auth = await verifyScopedToken(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }
    const tok = auth.token;
    if (!tok.permissions.create_sessions) {
      return NextResponse.json({ error: 'Unable to create link: scoped token permissions / create_sessions check - token lacks create_sessions', code: 'FORBIDDEN' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const validation = createSessionLinkSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: 'Unable to create link: session link administration / request validation - invalid request body', code: 'VALIDATION_ERROR', details: validation.error.errors }, { status: 400 });
    }
    if (validation.data.to_session_id === params.id) {
      return NextResponse.json({ error: 'Unable to create link: session link administration / target validation - cannot link a session to itself', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const fromTopic = await sessionTopicId(params.id);
    const toTopic = await sessionTopicId(validation.data.to_session_id);
    if (fromTopic === undefined || toTopic === undefined) {
      return NextResponse.json({ error: 'Unable to create link: session link administration / session lookup - one or both sessions not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    if (!tokenCovers(tok, fromTopic) || !tokenCovers(tok, toTopic)) {
      return NextResponse.json({ error: 'Unable to create link: scoped token permissions / scope check - one or both sessions outside token scope', code: 'FORBIDDEN' }, { status: 403 });
    }

    const result = await createSessionLink(params.id, validation.data.to_session_id, validation.data.label);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    logError({ consequence: 'Unable to create link', moduleProcess: 'scoped token manager / create link transaction', cause: 'session lookup, scope check, or link insert failed', error });
    return NextResponse.json({ error: 'Unable to create link: scoped token manager / create link transaction - internal error occurred', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/** Remove a link by id. */
export async function DELETE(request: NextRequest, { params }: { params: Params }) {
  try {
    const auth = await verifyScopedToken(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }
    const tok = auth.token;
    if (!tok.permissions.create_sessions) {
      return NextResponse.json({ error: 'Unable to delete link: scoped token permissions / create_sessions check - token lacks create_sessions', code: 'FORBIDDEN' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const linkId = typeof body.link_id === 'string' ? body.link_id.trim() : '';
    if (!linkId) {
      return NextResponse.json({ error: 'Unable to delete link: session link administration / link_id validation - link_id is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    await deleteSessionLink(linkId);
    return NextResponse.json({ success: true, id: linkId, deleted: true });
  } catch (error) {
    logError({ consequence: 'Unable to delete link', moduleProcess: 'scoped token manager / permanent link deletion', cause: 'link delete failed', error });
    return NextResponse.json({ error: 'Unable to delete link: scoped token manager / permanent link deletion - link delete failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
