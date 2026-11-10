import { promises as fs } from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { attachments } from '@/lib/schema';
import { authenticateUi, authErrorResponse } from '@/lib/ui-auth';
import { authorizeSession } from '@/lib/session-access';
import { blobPath } from '@/lib/media';
import { serviceInternalError } from '@/lib/service-route';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const [attachment] = await db.select().from(attachments).where(eq(attachments.id, params.id)).limit(1);
    if (!attachment) return NextResponse.json({ error: 'Image unavailable: media/content lookup - attachment not found' }, { status: 404 });
    const denied = await authorizeSession(auth.actor, attachment.sessionId, 'Unable to read attachment');
    if (denied) return authErrorResponse(denied);
    const headers: Record<string, string> = { 'Content-Type': attachment.mimeType, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.filename)}` };
    // nginx may serve bytes after this request has passed normal authorization.
    if (process.env.PCP_MEDIA_ACCEL === '1') {
      headers['X-Accel-Redirect'] = `/_pcp_blobs/${attachment.blobSha256.slice(0, 2)}/${attachment.blobSha256}`;
      return new NextResponse(null, { headers });
    }
    return new NextResponse(new Uint8Array(await fs.readFile(blobPath(attachment.blobSha256))), { headers });
  } catch (error) { return serviceInternalError('Unable to read attachment', 'media/content lookup', 'stored image is unavailable', error); }
}
