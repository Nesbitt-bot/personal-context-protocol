import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { attachments } from '@/lib/schema';
import { authenticateUi, authErrorResponse } from '@/lib/ui-auth';
import { authorizeSession } from '@/lib/session-access';
import { serviceInternalError } from '@/lib/service-route';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = await authorizeSession(auth.actor, params.id, 'Unable to list attachments');
    if (denied) return authErrorResponse(denied);
    const rows = await db.select({ id: attachments.id, messageId: attachments.messageId, filename: attachments.filename,
      mimeType: attachments.mimeType, sizeBytes: attachments.sizeBytes }).from(attachments).where(eq(attachments.sessionId, params.id));
    return NextResponse.json({ attachments: rows }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return serviceInternalError('Unable to list attachments', 'media/session lookup', 'attachment lookup failed', error); }
}
