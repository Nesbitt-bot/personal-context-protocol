import { boundedText } from '@/lib/bounded-body';
import { MediaError } from '@/lib/media';
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
    const parsed = completeTurnSchema.safeParse(JSON.parse(await boundedText(request)));
    if (!parsed.success) return NextResponse.json({ error: 'Unable to complete AstrBot turn: broker / request validation - invalid body', code: 'VALIDATION_ERROR' }, { status: 400 });
    const result = await completeBrokerTurn(auth.credential, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ success: true, recorded: result.recorded, ...(result.media.length ? { media: result.media } : {}) });
  } catch (error) {
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") return NextResponse.json({ code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    if (error instanceof MediaError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    logError({ consequence: 'Unable to complete AstrBot turn', moduleProcess: 'broker / complete turn', cause: 'turn recording failed', error });
    return NextResponse.json({ error: 'Unable to complete AstrBot turn: broker / complete turn - internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
