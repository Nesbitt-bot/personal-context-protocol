import { NextRequest, NextResponse } from 'next/server';
import { searchSchema } from '@/lib/validations';
import { serviceInternalError, serviceRequest } from '@/lib/service-route';
import { searchMessages } from '@/lib/turn-sync';
import { db } from '@/lib/db';
import { events } from '@/lib/schema';
import { createId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Substring search restricted to the grant's readable sessions. */
export async function POST(request: NextRequest) {
  const consequence = 'Unable to search context';
  try {
    const ctx = await serviceRequest(request, searchSchema, consequence, true);
    if ('response' in ctx) return ctx.response;
    const grant = ctx.grant!;
    const results = await searchMessages(grant.readableSessionIds, ctx.body.query, ctx.body.limit ?? 20);
    await db.insert(events).values({
      id: createId('evt'),
      sessionId: grant.homeSessionId,
      action: 'grant.search',
      actor: `service:${ctx.credential.id}`,
      detailsJson: { grant_id: grant.id, returned: results.length },
      createdAt: new Date(),
    });
    return NextResponse.json({ results });
  } catch (error) {
    return serviceInternalError(consequence, 'service sync / search', 'message search query failed', error);
  }
}
