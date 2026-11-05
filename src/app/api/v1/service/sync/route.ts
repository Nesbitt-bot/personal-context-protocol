import { NextRequest, NextResponse } from 'next/server';
import { syncTurnSchema } from '@/lib/validations';
import { serviceInternalError, serviceRequest } from '@/lib/service-route';
import { appendTurn } from '@/lib/turn-sync';

export const dynamic = 'force-dynamic';

/** Append one turn to the grant's home session, idempotent by external_key. */
export async function POST(request: NextRequest) {
  const consequence = 'Unable to sync turn';
  try {
    const ctx = await serviceRequest(request, syncTurnSchema, consequence, true);
    if ('response' in ctx) return ctx.response;
    if (ctx.grant!.origin === 'broker') {
      // The broker records its own turns; a delegate (openclaw-pcp) only reads.
      return NextResponse.json(
        { error: `${consequence}: service sync / grant scope check - broker turn grants are read-only for plugins; the broker records the turn`, code: 'FORBIDDEN' },
        { status: 403 },
      );
    }
    const result = await appendTurn(ctx.grant!, ctx.body.external_key, ctx.body.messages, `service:${ctx.credential.id}`);
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({
      success: true,
      duplicate: result.duplicate,
      session_id: result.sessionId,
      first_ordinal: result.firstOrdinal,
      message_count: result.messageCount,
    });
  } catch (error) {
    return serviceInternalError(consequence, 'service sync / append turn', 'turn ledger or message insert failed', error);
  }
}
