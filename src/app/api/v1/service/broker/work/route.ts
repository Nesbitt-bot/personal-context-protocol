import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { events } from '@/lib/schema';
import { verifyServiceCredential, deriveIngressSigningKey } from '@/lib/service-auth';
import { signatureMatches } from '@/lib/broker';
import { boundedText } from '@/lib/bounded-body';
import { serviceInternalError } from '@/lib/service-route';
export const dynamic = 'force-dynamic';
const schema = z.object({ after: z.string().datetime(), id: z.string().max(160), nonce: z.string().regex(/^[a-f0-9]{32}$/), ts: z.number().int() }).strict();
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyServiceCredential(request, ['ingress']);
    if (!('success' in auth)) return NextResponse.json({ code: auth.code }, { status: auth.status });
    const raw = await boundedText(request, 2048);
    if (!signatureMatches(deriveIngressSigningKey(auth.credential.id), raw, request.headers.get('x-pcp-signature'))) return NextResponse.json({ code: 'BAD_SIGNATURE' }, { status: 401 });
    const p = schema.safeParse(JSON.parse(raw));
    if (!p.success || Math.abs(Date.now() / 1000 - p.data.ts) > 120) return NextResponse.json({ code: 'INVALID_POLL' }, { status: 400 });
    const after = new Date(Math.max(Date.parse(p.data.after), Date.now() - 86400000));
    const rows = await db.select().from(events).where(and(eq(events.action, 'broker.work.update'), sql`${events.detailsJson}->>'ingress_id'=${auth.credential.id}`,
      or(gt(events.createdAt, after), and(eq(events.createdAt, after), gt(events.id, p.data.id))))).orderBy(asc(events.createdAt), asc(events.id)).limit(20);
    return NextResponse.json({ updates: rows.map(row => ({ id: row.id, created_at: row.createdAt, ...row.detailsJson as object })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return serviceInternalError('Unable to read coding progress', 'PCP/work poll', 'invalid poll or storage failure', error); }
}
