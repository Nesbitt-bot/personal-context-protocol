import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { events, turnGrants } from '@/lib/schema';
import { deriveIngressSigningKey, verifyServiceCredential } from '@/lib/service-auth';
import { signatureMatches } from '@/lib/broker';
import { boundedText } from '@/lib/bounded-body';
import { serviceInternalError } from '@/lib/service-route';

export const dynamic = 'force-dynamic';
const schema = z.object({ turn_id: z.string().regex(/^grt_[0-9a-f]{48}$/), event_id: z.string().regex(/^[0-9a-f]{32}$/),
  status: z.enum(['adapter_accepted', 'failed']), attachment_count: z.number().int().min(1).max(4) }).strict();

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyServiceCredential(request, ['ingress']);
    if (!('success' in auth)) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    const raw = await boundedText(request, 4096);
    if (!signatureMatches(deriveIngressSigningKey(auth.credential.id), raw, request.headers.get('x-pcp-signature'))) return NextResponse.json({ error: 'Receipt refused: broker/delivery authentication - signature mismatch', code: 'BAD_SIGNATURE' }, { status: 401 });
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return NextResponse.json({ error: 'Receipt refused: broker/delivery validation - malformed receipt', code: 'VALIDATION_ERROR' }, { status: 400 });
    const body = parsed.data;
    const [turn] = await db.select().from(turnGrants).where(and(eq(turnGrants.id, body.turn_id), eq(turnGrants.origin, 'broker'),
      eq(turnGrants.credentialId, auth.credential.id), gt(turnGrants.createdAt, new Date(Date.now() - 86400000)))).limit(1);
    if (!turn) return NextResponse.json({ error: 'Receipt refused: broker/delivery scope - no recent turn belongs to this ingress credential', code: 'TURN_NOT_FOUND' }, { status: 403 });
    const [completed] = await db.select().from(events).where(and(eq(events.sessionId, turn.homeSessionId),
      eq(events.action, 'broker.turn.completed'), sql`${events.detailsJson}->>'grant_id' = ${turn.id}`)).limit(1);
    const count = Number((completed?.detailsJson as { attachment_count?: number } | null)?.attachment_count || 0);
    if (count < body.attachment_count) return NextResponse.json({ error: 'Receipt refused: broker/delivery scope - no matching prepared media', code: 'MEDIA_NOT_PREPARED' }, { status: 409 });
    await db.insert(events).values({ id: `evt_delivery_${body.event_id}`, sessionId: turn.homeSessionId, action: `broker.media.${body.status}`,
      actor: `service:${auth.credential.id}`, detailsJson: { turn_id: turn.id, attachment_count: body.attachment_count, status: body.status } }).onConflictDoNothing();
    return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return serviceInternalError('Unable to record media delivery', 'broker/delivery receipt', 'invalid receipt or database failure', error); }
}
