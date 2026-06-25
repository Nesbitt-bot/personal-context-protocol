import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { messages, events } from '@/lib/schema';
import { createId } from '@/lib/auth';
import { logError } from '@/lib/logging';
import { editMessageSchema } from '@/lib/validations';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * Admin message correction (UI token). The append-only invariant applies to AI
 * tokens; a human admin may edit a wrongly-recorded/imported message here.
 * `PATCH /api/v1/sessions/<id>/messages/<messageId>` with `{ content }`.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; messageId: string } },
) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const body = await request.json().catch(() => ({}));
    const validation = editMessageSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Unable to edit message: session message correction / request validation - content is required',
          code: 'VALIDATION_ERROR',
          details: validation.error.errors,
        },
        { status: 400 },
      );
    }

    const [existing] = await db
      .select({ id: messages.id, ordinal: messages.ordinal })
      .from(messages)
      .where(and(eq(messages.id, params.messageId), eq(messages.sessionId, params.id)));

    if (!existing) {
      return NextResponse.json(
        { error: 'Unable to edit message: session message correction / message lookup - message not found in this session', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    await db.update(messages).set({ content: validation.data.content }).where(eq(messages.id, existing.id));

    await db.insert(events).values({
      id: createId('evt'),
      sessionId: params.id,
      action: 'message.edited',
      actor: 'human',
      detailsJson: { message_id: existing.id, ordinal: existing.ordinal },
      createdAt: new Date(),
    });

    return NextResponse.json({ success: true, id: existing.id, content: validation.data.content });
  } catch (error) {
    logError({
      consequence: 'Unable to edit message',
      moduleProcess: 'session message correction / edit message update',
      cause: 'message lookup, content update, or audit event insert failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to edit message: session message correction / edit message update - message lookup, content update, or audit event insert failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
