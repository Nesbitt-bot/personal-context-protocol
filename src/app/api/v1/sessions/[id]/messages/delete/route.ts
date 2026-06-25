import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { messages, events } from '@/lib/schema';
import { createId } from '@/lib/auth';
import { logError } from '@/lib/logging';
import { deleteMessagesSchema } from '@/lib/validations';
import { and, eq, inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * Admin bulk message deletion (UI token). Used to remove wrongly-recorded or
 * wrongly-imported messages. `POST /api/v1/sessions/<id>/messages/delete` with
 * `{ message_ids: [...] }` (one or many). Hard delete; ordinals keep their gaps,
 * which is fine because new appends use max(ordinal)+1.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const authResult = await verifyUiToken(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const body = await request.json().catch(() => ({}));
    const validation = deleteMessagesSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Unable to delete messages: session message correction / request validation - message_ids is required',
          code: 'VALIDATION_ERROR',
          details: validation.error.errors,
        },
        { status: 400 },
      );
    }

    // Only delete ids that actually belong to this session.
    const owned = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.sessionId, params.id), inArray(messages.id, validation.data.message_ids)));

    const ids = owned.map((row) => row.id);
    if (ids.length === 0) {
      return NextResponse.json({ success: true, deleted: 0 });
    }

    await db.delete(messages).where(and(eq(messages.sessionId, params.id), inArray(messages.id, ids)));

    await db.insert(events).values({
      id: createId('evt'),
      sessionId: params.id,
      action: 'message.deleted',
      actor: 'human',
      detailsJson: { deleted_count: ids.length, message_ids: ids },
      createdAt: new Date(),
    });

    return NextResponse.json({ success: true, deleted: ids.length });
  } catch (error) {
    logError({
      consequence: 'Unable to delete messages',
      moduleProcess: 'session message correction / bulk delete transaction',
      cause: 'ownership lookup, delete, or audit event insert failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to delete messages: session message correction / bulk delete transaction - ownership lookup, delete, or audit event insert failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
