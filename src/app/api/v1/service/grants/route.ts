import { NextRequest, NextResponse } from 'next/server';
import { createGrantSchema, endGrantSchema } from '@/lib/validations';
import { serviceInternalError, serviceRequest } from '@/lib/service-route';
import { createTurnGrant, revokeGrant } from '@/lib/turn-grants';
import { resolveAppBaseUrl } from '@/lib/recording-url';

export const dynamic = 'force-dynamic';

/**
 * Start a turn: PCP resolves the principal's home session and stores which
 * sessions this turn may read, keyed by the OpenClaw session key. The
 * response carries no credential; later calls present only the service
 * credential and the session key.
 */
export async function POST(request: NextRequest) {
  const consequence = 'Unable to create turn grant';
  try {
    const ctx = await serviceRequest(request, createGrantSchema, consequence, false);
    if ('response' in ctx) return ctx.response;
    const { body, credential } = ctx;

    const result = await createTurnGrant(credential, {
      sessionKey: body.session_key,
      principal: body.principal,
      chat: body.chat,
      groupId: body.group_id,
      ttlSeconds: body.ttl_seconds,
      issueClaim: body.issue_claim,
    });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });

    const base = resolveAppBaseUrl(request.nextUrl.origin);
    return NextResponse.json({
      grant_id: result.grantId,
      session_id: result.homeSessionId,
      readable_session_ids: result.readableSessionIds,
      expires_at: result.expiresAt.toISOString(),
      linked: Boolean(result.linkedUserId),
      claim: result.claim
        ? {
          code: result.claim.code,
          claim_url: base ? `${base}/claim?code=${encodeURIComponent(result.claim.code)}` : null,
          expires_at: result.claim.expiresAt.toISOString(),
        }
        : null,
    });
  } catch (error) {
    return serviceInternalError(consequence, 'service sync / turn grant', 'session resolution or grant insert failed', error);
  }
}

/** End the turn's grant early (body `{ session_key }`). */
export async function DELETE(request: NextRequest) {
  const consequence = 'Unable to end turn grant';
  try {
    const ctx = await serviceRequest(request, endGrantSchema, consequence, false);
    if ('response' in ctx) return ctx.response;
    const ended = await revokeGrant(ctx.credential.id, ctx.body.session_key);
    return NextResponse.json({ success: true, ended });
  } catch (error) {
    return serviceInternalError(consequence, 'service sync / end turn grant', 'grant update failed', error);
  }
}
