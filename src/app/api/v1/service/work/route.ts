import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { events, turnGrants } from '@/lib/schema';
import { verifyServiceCredential } from '@/lib/service-auth';
import { brokerGrantIdFromSessionKey, openclawBrokerSessionKey } from '@/lib/turn-grants';
import { appendTurn } from '@/lib/turn-sync';
import { boundedText } from '@/lib/bounded-body';
import { serviceInternalError } from '@/lib/service-route';

export const dynamic = 'force-dynamic';
const schema = z.object({ session_key: z.string().max(300), run_id: z.string().uuid(), child_session_key: z.string().regex(/^agent:opencode:acp:[a-f0-9-]{36}$/),
  sequence: z.number().int().min(0), state: z.enum(['started', 'running', 'completed', 'blocked']), text: z.string().min(1).max(12000) }).strict();
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyServiceCredential(request);
    if (!('success' in auth)) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    const parsed = schema.safeParse(JSON.parse(await boundedText(request, 20000)));
    if (!parsed.success) return NextResponse.json({ error: 'Progress rejected: PCP/work validation - invalid update', code: 'VALIDATION_ERROR' }, { status: 400 });
    const body = parsed.data, id = brokerGrantIdFromSessionKey(body.session_key);
    const [turn] = id ? await db.select().from(turnGrants).where(and(eq(turnGrants.id, id), eq(turnGrants.origin, 'broker'),
      eq(turnGrants.delegateCredentialId, auth.credential.id), gt(turnGrants.createdAt, new Date(Date.now() - 86400000)))).limit(1) : [];
    if (!turn || body.session_key !== openclawBrokerSessionKey(turn.agent!, turn.id)) return NextResponse.json({ error: 'Progress rejected: PCP/work scope - no matching delegated turn', code: 'FORBIDDEN' }, { status: 403 });
    const startedId = `evt_work_${body.run_id}_0`;
    const [existingStart] = await db.select().from(events).where(eq(events.id, startedId)).limit(1);
    const binding = existingStart?.detailsJson as Record<string, unknown> | undefined;
    if (existingStart && (binding?.parent_key !== body.session_key || binding.child_key !== body.child_session_key)) return NextResponse.json({ code: 'WORK_BINDING_MISMATCH' }, { status: 403 });
    if (body.sequence === 0 && !existingStart) {
      if (body.state !== 'started' || turn.expiresAt < new Date()) return NextResponse.json({ error: 'Progress rejected: PCP/work registration - parent grant expired or closed', code: 'GRANT_REQUIRED' }, { status: 403 });
    } else if (body.sequence > 0) {
      const [started] = await db.select().from(events).where(eq(events.id, startedId)).limit(1);
      const details = started?.detailsJson as Record<string, unknown> | undefined;
      if (details?.parent_key !== body.session_key || details.child_key !== body.child_session_key) return NextResponse.json({ error: 'Progress rejected: PCP/work scope - run is not registered to this parent', code: 'WORK_NOT_REGISTERED' }, { status: 403 });
    }
    const [prepared] = await db.select().from(events).where(and(eq(events.sessionId, turn.homeSessionId), eq(events.action, 'broker.turn.prepared'), sql`${events.detailsJson}->>'grant_id'=${turn.id}`)).limit(1);
    const route = (prepared?.detailsJson as Record<string, unknown> | undefined)?.delivery_route;
    if (!route) return NextResponse.json({ error: 'Progress unavailable: PCP/work route - original signed destination is missing', code: 'DELIVERY_ROUTE_MISSING' }, { status: 409 });
    const eventId = `evt_work_${body.run_id}_${body.sequence}`;
    await db.insert(events).values({ id: eventId, sessionId: turn.homeSessionId, action: 'broker.work.update', actor: `service:${auth.credential.id}`,
      detailsJson: { parent_key: body.session_key, child_key: body.child_session_key, run_id: body.run_id, state: body.state, text: body.text,
        ingress_id: turn.credentialId, delivery_route: route }, createdAt: new Date() }).onConflictDoNothing();
    if (['completed', 'blocked'].includes(body.state)) {
      await appendTurn({ id: turn.id, principal: turn.principal, homeSessionId: turn.homeSessionId, readableSessionIds: [], expiresAt: new Date(Date.now() + 1000), origin: 'broker', agent: turn.agent, externalKey: turn.externalKey, delegated: true },
        `work:${body.run_id}:${body.sequence}`, [{ role: 'assistant', content: body.text, provider: 'opencode' }], `service:${auth.credential.id}`);
    }
    return NextResponse.json({ success: true });
  } catch (error) { return serviceInternalError('Unable to persist coding progress', 'PCP/work update', 'invalid update or storage failure', error); }
}
