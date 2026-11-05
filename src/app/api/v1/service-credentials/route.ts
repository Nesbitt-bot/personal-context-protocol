import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { createServiceCredentialSchema } from '@/lib/validations';
import { createServiceCredential } from '@/lib/service-auth';
import { resolveExpiresAt, tokenStatus } from '@/lib/token-expiration';
import { db } from '@/lib/db';
import { events, serviceCredentials } from '@/lib/schema';
import { createId } from '@/lib/auth';
import { logError } from '@/lib/logging';

export const dynamic = 'force-dynamic';

async function admin(request: NextRequest, consequence: string) {
  const auth = await authenticateUi(request);
  if ('error' in auth) return { response: authErrorResponse(auth) };
  const denied = requireAdmin(auth.actor, consequence);
  if (denied) return { response: authErrorResponse(denied) };
  return { actor: auth.actor };
}

/** Admin: list service credentials (never their hashes). */
export async function GET(request: NextRequest) {
  try {
    const gate = await admin(request, 'Unable to list service credentials');
    if ('response' in gate) return gate.response;
    const rows = await db.select().from(serviceCredentials).orderBy(desc(serviceCredentials.createdAt));
    const now = new Date();
    return NextResponse.json({
      credentials: rows.map((row) => ({
        id: row.id,
        name: row.name,
        principal_prefixes: row.principalPrefixesJson,
        status: tokenStatus(row, now),
        created_at: row.createdAt,
        expires_at: row.expiresAt,
        last_used_at: row.lastUsedAt,
      })),
    });
  } catch (error) {
    logError({ consequence: 'Unable to list service credentials', moduleProcess: 'service credential administration / list', cause: 'credential query failed', error });
    return NextResponse.json({ error: 'Unable to list service credentials: service credential administration / list - credential query failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/** Admin: mint a service credential; the plaintext token is returned once. */
export async function POST(request: NextRequest) {
  try {
    const gate = await admin(request, 'Unable to create service credential');
    if ('response' in gate) return gate.response;
    const parsed = createServiceCredentialSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Unable to create service credential: service credential administration / request validation - invalid request body', code: 'VALIDATION_ERROR', details: parsed.error.errors }, { status: 400 });
    }
    const now = new Date();
    const expiresAt = resolveExpiresAt(parsed.data.expires_in ?? 'never', now);
    const { id, token } = await createServiceCredential(parsed.data.name, parsed.data.principal_prefixes, expiresAt);
    await db.insert(events).values({
      id: createId('evt'),
      action: 'service_credential.created',
      actor: 'human',
      detailsJson: { credential_id: id, name: parsed.data.name, principal_prefixes: parsed.data.principal_prefixes, by: gate.actor.userId },
      createdAt: now,
    });
    return NextResponse.json({ success: true, id, token, expires_at: expiresAt?.toISOString() ?? null });
  } catch (error) {
    logError({ consequence: 'Unable to create service credential', moduleProcess: 'service credential administration / create', cause: 'credential hash or insert failed', error });
    return NextResponse.json({ error: 'Unable to create service credential: service credential administration / create - credential hash or insert failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/** Admin: revoke a service credential (body `{ id }`). */
export async function DELETE(request: NextRequest) {
  try {
    const gate = await admin(request, 'Unable to revoke service credential');
    if ('response' in gate) return gate.response;
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === 'string' ? body.id : '';
    const rows = await db.update(serviceCredentials).set({ revoked: true }).where(eq(serviceCredentials.id, id)).returning({ id: serviceCredentials.id });
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Unable to revoke service credential: service credential administration / lookup - credential not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    await db.insert(events).values({
      id: createId('evt'),
      action: 'service_credential.revoked',
      actor: 'human',
      detailsJson: { credential_id: id, by: gate.actor.userId },
      createdAt: new Date(),
    });
    return NextResponse.json({ success: true, id, revoked: true });
  } catch (error) {
    logError({ consequence: 'Unable to revoke service credential', moduleProcess: 'service credential administration / revoke', cause: 'credential update failed', error });
    return NextResponse.json({ error: 'Unable to revoke service credential: service credential administration / revoke - credential update failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
