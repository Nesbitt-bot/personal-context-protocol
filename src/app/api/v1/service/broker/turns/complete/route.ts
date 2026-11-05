import { NextRequest, NextResponse } from 'next/server';
import { verifyServiceCredential } from '@/lib/service-auth';
import { completeBrokerTurn, completeTurnSchema } from '@/lib/broker';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/** Broker only: record the reply (or failure) of a prepared turn and end its grant. */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyServiceCredential(request, ['broker']);
    if (!('success' in auth)) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    const parsed = completeTurnSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Unable to complete AstrBot turn: broker / request validation - invalid body', code: 'VALIDATION_ERROR' }, { status: 400 });
    const result = await completeBrokerTurn(auth.credential, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ success: true, recorded: result.recorded });
  } catch (error) {
    logError({ consequence: 'Unable to complete AstrBot turn', moduleProcess: 'broker / complete turn', cause: 'turn recording failed', error });
    return NextResponse.json({ error: 'Unable to complete AstrBot turn: broker / complete turn - internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
