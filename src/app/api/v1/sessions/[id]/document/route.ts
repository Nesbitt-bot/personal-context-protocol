import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse } from '@/lib/ui-auth';
import { authorizeSession } from '@/lib/session-access';
import { boundedText } from '@/lib/bounded-body';
import { MAX_DOCUMENT_BYTES, parseSessionDocument } from '@/lib/session-document';
import { DocumentImportError, exportSessionDocument, importSessionDocument } from '@/lib/session-document-store';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = await authorizeSession(auth.actor, params.id, 'Unable to export JSON');
    if (denied) return authErrorResponse(denied);
    const document = await exportSessionDocument(params.id);
    if (!document) return NextResponse.json({ error: 'Unable to export JSON: session document / lookup - session not found' }, { status: 404 });
    const content = JSON.stringify(document, null, 2);
    if (Buffer.byteLength(content) > MAX_DOCUMENT_BYTES || !parseSessionDocument(document).success) {
      return NextResponse.json({ error: 'Unable to export JSON: session document / size validation - session exceeds the supported document limits (20 MiB, 10,000 messages, 100,000 characters per message)' }, { status: 413 });
    }
    return new NextResponse(content, { headers: { 'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="pcp-session-${params.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json"`,
      'Cache-Control': 'private, no-store',
    } });
  } catch (error) {
    logError({ consequence: 'Unable to export JSON', moduleProcess: 'session document / export', cause: 'session document query failed', error });
    return NextResponse.json({ error: 'Unable to export JSON: session document / export - database query failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = await authorizeSession(auth.actor, params.id, 'Unable to import JSON');
    if (denied) return authErrorResponse(denied);
    let input: unknown;
    try { input = JSON.parse(await boundedText(request, MAX_DOCUMENT_BYTES)); }
    catch (error) {
      const tooLarge = error instanceof Error && error.message === 'BODY_TOO_LARGE';
      return NextResponse.json({ error: `Unable to import JSON: session document / file parsing - ${tooLarge ? 'file exceeds 20 MiB' : 'file is not valid JSON'}` }, { status: tooLarge ? 413 : 400 });
    }
    const parsed = parseSessionDocument(input);
    if (!parsed.success) return NextResponse.json({
      error: 'Unable to import JSON: session document / schema validation - expected sid, title, summary and messages with unique ordinals, supported roles and text content',
      details: parsed.error.issues,
    }, { status: 422 });
    const result = await importSessionDocument(params.id, parsed.data, `human:${auth.actor.userId}`);
    return NextResponse.json({ success: true, session_id: params.id, ...result });
  } catch (error) {
    if (error instanceof DocumentImportError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    logError({ consequence: 'Unable to import JSON', moduleProcess: 'session document / import', cause: 'document transaction failed', error });
    return NextResponse.json({ error: 'Unable to import JSON: session document / import - database transaction failed; no changes were saved' }, { status: 500 });
  }
}
