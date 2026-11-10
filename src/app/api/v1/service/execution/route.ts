import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { serviceRequest, serviceInternalError } from '@/lib/service-route';
import { executionRule } from '@/lib/execution-policy';
import { ownerForPrincipal } from '@/lib/claims';
import { db } from '@/lib/db';
import { sessions, users } from '@/lib/schema';
import { openclawBrokerSessionKey } from '@/lib/turn-grants';

export const dynamic = 'force-dynamic';
const schema = z.object({ session_key: z.string().max(300), tool_name: z.string().max(80) }).strict();

/** Called by the gateway plugin, never by the model or AstrBot ingress. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await serviceRequest(request, schema, 'Unable to authorize execution', true);
    if ('response' in ctx) return ctx.response;
    const { grant, body } = ctx;
    const denied = () => NextResponse.json({ allowed: false, error: 'Execution refused: broker/tool authorization - no matching live execution grant', code: 'EXECUTION_DENIED' }, { status: 403 });
    if (!grant || grant.origin !== 'broker' || !grant.delegated || !grant.agent
      || body.session_key !== openclawBrokerSessionKey(grant.agent, grant.id)) return denied();
    const [home] = await db.select().from(sessions).where(eq(sessions.id, grant.homeSessionId)).limit(1);
    if (!home || home.archived) return denied();
    const owner = await ownerForPrincipal(grant.principal);
    const [user] = owner ? await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, owner)).limit(1) : [];
    const [, platform, sender_id] = grant.principal.split(':');
    const rule = executionRule({ platform, sender_id, chat: home.sessionClass === 'group' ? 'group' : 'private',
      group_id: home.sessionClass === 'group' ? home.principal?.split(':').at(-1) : undefined }, user?.isAdmin === true);
    if (!rule || rule.agent !== grant.agent || !(rule.tools as string[]).includes(body.tool_name)) return denied();
    return NextResponse.json({ allowed: true, agent: grant.agent, workspace_key: grant.homeSessionId, expires_at: grant.expiresAt.toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return serviceInternalError('Unable to authorize execution', 'broker/tool authorization', 'policy or identity lookup failed', error);
  }
}
