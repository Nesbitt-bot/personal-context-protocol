import { NextRequest, NextResponse } from 'next/server';
import { requireProjectToken, validationError } from '@/lib/project-access';
import { mergeMessagesSchema } from '@/lib/project-validations';
import { sessionByExternalKey } from '@/lib/manager-session-key';
import { mergeSessionMessages } from '@/lib/sync-store';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

/**
 * Append-only multi-machine message merge: messages carry the plugin's own
 * message id; ids PCP already holds are skipped, the rest are appended in
 * timestamp order. Existing messages are never changed.
 */
export async function POST(request: NextRequest, { params }: { params: { key: string } }) {
  const consequence = 'Unable to merge messages';
  try {
    const gate = await requireProjectToken(request, consequence, 'write');
    if ('response' in gate) return gate.response;
    const parsed = mergeMessagesSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(consequence, 'session sync / message validation', parsed.error.errors);
    const session = await sessionByExternalKey(params.key);
    if (session && 'error' in session) return NextResponse.json({ error: `${consequence}: session sync / external key validation - ${session.error}`, code: 'VALIDATION_ERROR' }, { status: 400 });
    if (!session) return NextResponse.json({ error: `${consequence}: session sync / session lookup - no session has this external key`, code: 'NOT_FOUND' }, { status: 404 });
    const outcome = await mergeSessionMessages(session.id, parsed.data.messages, parsed.data.device_id, gate.actor);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
    return NextResponse.json({ session_id: session.id, ...outcome });
  } catch (error) {
    logError({ consequence, moduleProcess: 'session sync / merge messages', cause: 'session lock or message insert failed', error });
    return NextResponse.json({ error: `${consequence}: session sync / merge messages - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
