import { NextRequest, NextResponse } from 'next/server';
import { recallSchema } from '@/lib/validations';
import { serviceInternalError, serviceRequest } from '@/lib/service-route';
import { recallMessages } from '@/lib/turn-sync';
import { db } from '@/lib/db';
import { events } from '@/lib/schema';
import { createId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Recent messages from the grant's readable sessions (or one of them). */
export async function POST(request: NextRequest) {
  const consequence = 'Unable to recall context';
  try {
    const ctx = await serviceRequest(request, recallSchema, consequence, true);
    if ('response' in ctx) return ctx.response;
    const grant = ctx.grant!;
    const requested = ctx.body.session_id;
    if (requested && !grant.readableSessionIds.includes(requested)) {
      return NextResponse.json(
        { error: `${consequence}: service sync / grant scope check - that session is not readable in this turn`, code: 'FORBIDDEN' },
        { status: 403 },
      );
    }
    const ids = requested ? [requested] : grant.readableSessionIds;
    const result = await recallMessages(ids, ctx.body.limit ?? 30);
    await db.insert(events).values({
      id: createId('evt'),
      sessionId: grant.homeSessionId,
      action: 'grant.recall',
      actor: `service:${ctx.credential.id}`,
      detailsJson: { grant_id: grant.id, session_ids: ids.length, returned: result.messages.length },
      createdAt: new Date(),
    });
    return NextResponse.json({ home_session_id: grant.homeSessionId, ...result });
  } catch (error) {
    return serviceInternalError(consequence, 'service sync / recall', 'message query failed', error);
  }
}
