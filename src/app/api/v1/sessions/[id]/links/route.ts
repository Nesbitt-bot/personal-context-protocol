import { NextResponse, NextRequest } from 'next/server';
import { eq, or, inArray } from 'drizzle-orm';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { sessionLinks, sessions } from '@/lib/schema';
import { createId } from '@/lib/auth';
import { logError } from '@/lib/logging';
import { createSessionLinkSchema } from '@/lib/validations';

export const dynamic = 'force-dynamic';

interface Params { id: string; }

/** List every link attached to a session, with the linked session's title. */
export async function GET(request: NextRequest, { params }: { params: Params }) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const rows = await db
      .select()
      .from(sessionLinks)
      .where(or(eq(sessionLinks.sessionA, params.id), eq(sessionLinks.sessionB, params.id)));

    const otherIds = rows.map((r) => (r.sessionA === params.id ? r.sessionB : r.sessionA));
    const linkedSessions = otherIds.length
      ? await db.select({ id: sessions.id, title: sessions.title }).from(sessions).where(inArray(sessions.id, otherIds))
      : [];

    const titleById = new Map(linkedSessions.map((s) => [s.id, s.title]));
    const links = rows.map((r) => {
      const otherId = r.sessionA === params.id ? r.sessionB : r.sessionA;
      return {
        id: r.id,
        other_session_id: otherId,
        other_title: titleById.get(otherId) ?? null,
        label: r.label ?? null,
        created_at: r.createdAt,
      };
    });

    return NextResponse.json({ links });
  } catch (error) {
    logError({
      consequence: 'Unable to list links',
      moduleProcess: 'session link administration / link list query',
      cause: 'link or session query failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to list links: session link administration / link list query - link or session query failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

/** Create an undirected link between this session and another. */
export async function POST(request: NextRequest, { params }: { params: Params }) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const body = await request.json().catch(() => ({}));
    const validation = createSessionLinkSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Unable to create link: session link administration / request validation - invalid request body', code: 'VALIDATION_ERROR', details: validation.error.errors },
        { status: 400 },
      );
    }

    const toId = validation.data.to_session_id;
    if (toId === params.id) {
      return NextResponse.json(
        { error: 'Unable to create link: session link administration / target validation - cannot link a session to itself', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const sessionIds = [params.id, toId];
    const targets = await db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.id, sessionIds));
    if (targets.length !== 2) {
      return NextResponse.json(
        { error: 'Unable to create link: session link administration / session lookup - one or both sessions not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // Normalize order so the pair is unique regardless of direction.
    const sessionA = params.id < toId ? params.id : toId;
    const sessionB = params.id < toId ? toId : params.id;

    const [existing] = await db
      .select()
      .from(sessionLinks)
      .where(or(
        eq(sessionLinks.sessionA, sessionA),
        eq(sessionLinks.sessionB, sessionB),
      ));
    if (existing && existing.sessionA === sessionA && existing.sessionB === sessionB) {
      return NextResponse.json({ success: true, id: existing.id, label: existing.label, created_at: existing.createdAt, duplicate: true });
    }

    const id = createId('lnk');
    const now = new Date();
    await db.insert(sessionLinks).values({
      id,
      sessionA,
      sessionB,
      label: validation.data.label ?? null,
      createdAt: now,
    });

    return NextResponse.json({ success: true, id, label: validation.data.label ?? null, created_at: now.toISOString() });
  } catch (error) {
    logError({
      consequence: 'Unable to create link',
      moduleProcess: 'session link administration / create link transaction',
      cause: 'session lookup, link insert, or duplicate check failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to create link: session link administration / create link transaction - internal error occurred', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

/** Remove a link by its id. */
export async function DELETE(request: NextRequest, { params }: { params: Params }) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const body = await request.json().catch(() => ({}));
    const linkId = typeof body.link_id === 'string' ? body.link_id.trim() : '';
    if (!linkId) {
      return NextResponse.json(
        { error: 'Unable to delete link: session link administration / link_id validation - link_id is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    await db.delete(sessionLinks).where(eq(sessionLinks.id, linkId));
    return NextResponse.json({ success: true, id: linkId, deleted: true });
  } catch (error) {
    logError({
      consequence: 'Unable to delete link',
      moduleProcess: 'session link administration / permanent link deletion',
      cause: 'link delete failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to delete link: session link administration / permanent link deletion - link delete failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
