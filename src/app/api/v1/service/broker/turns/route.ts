import { NextRequest, NextResponse } from 'next/server';
import { verifyServiceCredential } from '@/lib/service-auth';
import { prepareBrokerTurn } from '@/lib/broker';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Broker only: prepare one AstrBot turn. Authorization is the broker's own
 * credential; `x-pcp-ingress-authorization` carries the AstrBot ingress
 * credential and `x-pcp-signature` the HMAC over the raw body, both exactly
 * as AstrBot sent them to the loopback broker.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyServiceCredential(request, ['broker']);
    if (!('success' in auth)) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    const raw = await request.text();
    const result = await prepareBrokerTurn(auth.credential, request.headers.get('x-pcp-ingress-authorization'), request.headers.get('x-pcp-signature'), raw);
    if (!result.ok) {
      if (result.status === 401) console.warn(`AstrBot turn refused: PCP broker / ingress verification — ${result.code}.`);
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json({
      turn_id: result.turnId,
      session_key: result.sessionKey,
      agent: result.agent,
      model: result.model,
      messages: result.messages,
      expires_at: result.expiresAt.toISOString(),
    });
  } catch (error) {
    logError({ consequence: 'Unable to accept AstrBot turn', moduleProcess: 'broker / prepare turn', cause: 'verification, grant or context query failed', error });
    return NextResponse.json({ error: 'Unable to accept AstrBot turn: broker / prepare turn - internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
