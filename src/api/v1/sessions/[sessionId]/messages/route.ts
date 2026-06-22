import { NextResponse, NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { messages, sessions, events } from '@/lib/schema';
import { createId } from '@/lib/auth';
import { appendMessagesSchema } from '@/lib/validations';
import { sql, eq } from 'drizzle-orm';

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    // Verify session token
    const authResult = await verifySessionToken(request, params.sessionId);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error, code: authResult.code }, { status: authResult.status });
    }

    const body = await request.json();
    const validation = appendMessagesSchema.safeParse(body);
    
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Unable to append messages: request validation — invalid request body',
          code: 'VALIDATION_ERROR',
          details: validation.error.errors,
        },
        { status: 400 },
      );
    }

    const { messages: newMessages, suggested_session_title } = validation.data;

    // Verify session exists and is not archived
    const [session] = await db
      .select({ archived: sessions.archived, topicId: sessions.topicId, title: sessions.title })
      .from(sessions)
      .where(eq(sessions.id, params.sessionId));

    if (!session) {
      return NextResponse.json(
        {
          error: 'Unable to append messages: resource lookup — session not found',
          code: 'NOT_FOUND',
        },
        { status: 404 },
      );
    }

    if (session.archived) {
      return NextResponse.json(
        {
          error: 'Unable to append messages: session state — session is archived',
          code: 'FORBIDDEN',
        },
        { status: 403 },
      );
    }

    // Check if token can rename session
    if (suggested_session_title && !authResult.canRenameSession) {
      return NextResponse.json(
        {
          error: 'Unable to rename session: token permissions — this token cannot suggest session titles',
          code: 'FORBIDDEN',
        },
        { status: 403 },
      );
    }

    // Insert messages in transaction
    const insertedMessages = await db.transaction(async (tx) => {
      // Get current max ordinal for this session
      const [maxOrdinal] = await tx
        .select({ max: sql<number>`max(${messages.ordinal})` })
        .from(messages)
        .where(eq(messages.sessionId, params.sessionId));

      let currentOrdinal = maxOrdinal?.max ? maxOrdinal.max : 0;
      const inserted: Array<{ id: string; ordinal: number }> = [];

      for (const msg of newMessages) {
        currentOrdinal++;
        const messageId = createId('msg');

        await tx.insert(messages).values({
          id: messageId,
          sessionId: params.sessionId,
          topicId: session.topicId, // Denormalized from session
          ordinal: currentOrdinal,
          role: msg.role,
            content: msg.content,
            contentType: 'markdown', // Default
            provider: msg.provider || 'unknown',
            BaseModel: msg.base_model || 'unknown',
            providerTimestamp: msg.provider_timestamp ? new Date(msg.provider_timestamp) : null,
            observedAt: new Date(),
            sourceJson: null,
            metadataJson: {},
            createdAt: new Date(),
          });

          inserted.push({ id: messageId, ordinal: currentOrdinal });
        }

        // Update session last_message_at
        await tx
          .update(sessions)
          .set({ lastMessageAt: new Date() })
          .where(eq(sessions.id, params.sessionId));

        // Log event
        await tx.insert(events).values({
          id: createId('evt'),
          sessionId: params.sessionId,
          action: 'message.appended',
          actor: `ai:${params.sessionId}`,
          detailsJson: { message_count: newMessages.length, first_ordinal: currentOrdinal - newMessages.length + 1 },
          createdAt: new Date(),
        });

        return inserted;
      });

    // Rename session if suggested
    if (suggested_session_title) {
      await db
        .update(sessions)
        .set({ title: suggested_session_title, updatedAt: new Date() })
        .where(eq(sessions.id, params.sessionId));

      await db.insert(events).values({
        id: createId('evt'),
        sessionId: params.sessionId,
        action: 'session.renamed',
        actor: `ai:${params.sessionId}`,
        detailsJson: { suggested_title: suggested_session_title },
        createdAt: new Date(),
      });
    }

    return NextResponse.json({
      success: true,
      messages: insertedMessages.map((m, i) => ({
        id: m.id,
        session_id: params.sessionId,
        ordinal: m.ordinal,
        created_at: new Date().toISOString(),
      })),
      session: {
        id: params.sessionId,
        title: suggested_session_title || session.title,
        last_message_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Message append error:', error);
    return NextResponse.json(
      {
        error: 'Unable to append messages: database transaction — internal error occurred',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 },
    );
  }
}
