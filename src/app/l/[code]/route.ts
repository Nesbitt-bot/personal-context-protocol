import { NextResponse, NextRequest } from 'next/server';
import { count, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { messages, sessions } from '@/lib/schema';
import { resolveAccessCode, touchAccessCode } from '@/lib/access-code';
import { buildLinkInstructionMarkdown } from '@/lib/agent-markdown';
import { resolveAppBaseUrl } from '@/lib/recording-url';
import { normalizeRecordingMode } from '@/lib/agent-protocol';

export const dynamic = 'force-dynamic';

function markdown(body: string, status: number) {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}

/**
 * Public temporary bind/sync entry point. The code in the URL is the whole
 * credential. A valid fetch serves the instruction document and refreshes the
 * 1-hour idle window; expired/revoked links explain themselves.
 */
export async function GET(request: NextRequest, { params }: { params: { code: string } }) {
  const resolved = await resolveAccessCode(params.code);

  if (resolved.status !== 'ok') {
    if (resolved.status === 'unknown') {
      return markdown('# Personal Context Protocol\n\nThis temporary access link is not recognized.\n', 404);
    }
    const reason = resolved.status.replace(/_/g, ' ');
    return markdown(
      `# Personal Context Protocol\n\nThis temporary access link is **${reason}**. Ask whoever shared it to generate a fresh link from their dashboard.\n`,
      410,
    );
  }

  const { row } = resolved;
  const [session] = await db
    .select({ title: sessions.title, mode: sessions.mode })
    .from(sessions)
    .where(eq(sessions.id, row.sessionId))
    .limit(1);
  if (!session) {
    return markdown('# Personal Context Protocol\n\nThe session this link points to no longer exists.\n', 410);
  }

  const [c] = await db.select({ n: count(messages.id) }).from(messages).where(eq(messages.sessionId, row.sessionId));

  // Any agent read refreshes the idle window.
  await touchAccessCode(row.id);

  const markdownDoc = buildLinkInstructionMarkdown({
    base: resolveAppBaseUrl(request.nextUrl.origin),
    sessionId: row.sessionId,
    code: params.code,
    title: session.title,
    mode: normalizeRecordingMode(session.mode),
    existingMessageCount: Number(c?.n ?? 0),
  });
  return markdown(markdownDoc, 200);
}
