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

    // Record a compaction when present (compact-only or mixed).
    let compactionsImported = 0;
    if (result.kind === 'compact' || result.kind === 'mixed') {
      const stored = await recordCompaction({ sessionId: params.id, compact: result.compact, actor: 'human:import' });
      if (!stored.ok) {
        return NextResponse.json(
          { error: `Unable to import compaction: session import / ${stored.code}`, code: stored.code },
          { status: FAILURE_STATUS[stored.code] || 500 },
        );
      }
      compactionsImported = 1;
    }

    // Append only the messages not already present (compact-only has none).
    const incoming = result.kind === 'messages' || result.kind === 'mixed' ? result.messages : [];
    let messagesImported = 0;
    let skipped = 0;

    if (incoming.length > 0) {
      const existing = await db
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(eq(messages.sessionId, params.id));

      const deduped = dedupeNewMessages(incoming, existing);
      skipped = deduped.skipped;

      if (deduped.fresh.length > 0) {
        const appended = await appendMessagesToSession({
          sessionId: params.id,
          messages: deduped.fresh,
          canRenameSession: true,
          actor: 'human:import',
        });
        if (!appended.ok) {
          return NextResponse.json(
            { error: `Unable to import messages: session import / ${appended.code}`, code: appended.code },
            { status: FAILURE_STATUS[appended.code] || 500 },
          );
        }
        messagesImported = appended.messages.length;
      }
    }

    const notice = compactionsImported > 0 && messagesImported === 0
      ? 'Imported a compact summary. No raw messages were included.'
      : messagesImported === 0 && incoming.length > 0
        ? 'Everything in the paste was already recorded.'
        : `Imported ${messagesImported} message(s)${compactionsImported ? ' and a compact summary' : ''}.`;

    const events = (messagesImported > 0 ? 1 : 0) + compactionsImported;
    return NextResponse.json({
      success: true,
      ok: true,
      session_id: params.id,
      imported: { messages: messagesImported, compactions: compactionsImported, events, duplicates_skipped: skipped },
      skipped,
      notice,
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
