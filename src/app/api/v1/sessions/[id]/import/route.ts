import { NextResponse, NextRequest } from 'next/server';
import { verifyUiToken } from '@/lib/middleware';
import { db } from '@/lib/db';
import { messages } from '@/lib/schema';
import { appendMessagesToSession, recordCompaction } from '@/lib/recording-store';
import { parseIngestPayload } from '@/lib/ingest';
import { dedupeNewMessages } from '@/lib/import-merge';
import { logError } from '@/lib/logging';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// Human paste-import allows a larger batch than the per-request agent limit.
const MAX_IMPORT_MESSAGES = 500;

const FAILURE_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  SESSION_ARCHIVED: 403,
  FORBIDDEN: 403,
};

/**
 * Human fallback import: `POST /api/v1/sessions/<id>/import` (UI token). Accepts
 * the same forgiving formats as agent ingest (a `{ messages }` block, an agent
 * wrapper object, `<PCP_APPEND>`/`<PCP_COMPACT>`, ChatML, or raw transcript) and
 * records it, skipping messages already present so re-pasting merges cleanly.
 * Body: `{ "payload": "<pasted text>" }` or the raw pasted text.
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

    const raw = await request.text().catch(() => '');
    // Accept either { payload: "..." } JSON or the raw pasted text directly.
    let payload = raw;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.payload === 'string') {
        payload = parsed.payload;
      }
    } catch {
      // Not a JSON envelope; treat the body as the pasted text.
    }

    const result = parseIngestPayload(payload, { maxMessages: MAX_IMPORT_MESSAGES });

    if (result.kind === 'error') {
      return NextResponse.json(
        {
          error: 'Unable to import: session import / payload parsing - the pasted text did not match any supported format',
          code: 'UNPARSEABLE_PAYLOAD',
          reason: result.reason,
          hint: 'Paste a { "messages": [...] } block, an agent fallback JSON, a <PCP_COMPACT> block, or a plain transcript.',
        },
        { status: 422 },
      );
    }

    if (result.kind === 'compact') {
      const stored = await recordCompaction({ sessionId: params.id, compact: result.compact, actor: 'human:import' });
      if (!stored.ok) {
        return NextResponse.json(
          { error: `Unable to import compaction: session import / ${stored.code}`, code: stored.code },
          { status: FAILURE_STATUS[stored.code] || 500 },
        );
      }
      return NextResponse.json({ success: true, imported_as: 'compact', compaction: stored.compaction });
    }

    // result.kind === 'messages' — append only the messages not already present.
    const existing = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.sessionId, params.id));

    const { fresh, skipped } = dedupeNewMessages(result.messages, existing);

    if (fresh.length === 0) {
      return NextResponse.json({ success: true, imported_as: 'messages', imported: 0, skipped, note: 'Everything in the paste was already recorded.' });
    }

    const appended = await appendMessagesToSession({
      sessionId: params.id,
      messages: fresh,
      canRenameSession: true,
      actor: 'human:import',
    });

    if (!appended.ok) {
      return NextResponse.json(
        { error: `Unable to import messages: session import / ${appended.code}`, code: appended.code },
        { status: FAILURE_STATUS[appended.code] || 500 },
      );
    }

    return NextResponse.json({
      success: true,
      imported_as: 'messages',
      imported: appended.messages.length,
      skipped,
    });
  } catch (error) {
    logError({
      consequence: 'Unable to import session content',
      moduleProcess: 'session import / paste import transaction',
      cause: 'auth, payload parsing, dedup, or persistence failed',
      error,
    });
    return NextResponse.json(
      { error: 'Unable to import session content: session import / paste import transaction - auth, payload parsing, dedup, or persistence failed', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
