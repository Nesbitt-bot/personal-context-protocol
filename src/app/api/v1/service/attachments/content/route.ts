import { promises as fs } from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { serviceRequest, serviceInternalError } from '@/lib/service-route';
import { db } from '@/lib/db';
import { attachments } from '@/lib/schema';
import { blobPath } from '@/lib/media';

export const dynamic = 'force-dynamic';
const schema = z.object({ session_key: z.string().max(300), attachment_id: z.string().max(100) }).strict();
export async function POST(request: NextRequest) {
  try {
    const ctx = await serviceRequest(request, schema, 'Unable to recall image', true);
    if ('response' in ctx) return ctx.response;
    const [attachment] = await db.select().from(attachments).where(eq(attachments.id, ctx.body.attachment_id)).limit(1);
    if (!attachment || !ctx.grant!.readableSessionIds.includes(attachment.sessionId)) return NextResponse.json({ error: 'Image unavailable: media/grant authorization - attachment is outside this turn scope', code: 'FORBIDDEN' }, { status: 403 });
    const data = await fs.readFile(blobPath(attachment.blobSha256));
    return NextResponse.json({ data: data.toString('base64'), mime_type: attachment.mimeType }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return serviceInternalError('Unable to recall image', 'media/grant read', 'attachment storage is unavailable', error); }
}
