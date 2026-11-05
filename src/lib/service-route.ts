import { NextRequest, NextResponse } from 'next/server';
import { ZodSchema } from 'zod';
import { verifyServiceCredential, ResolvedServiceCredential } from './service-auth';
import { findActiveGrant, ActiveGrant } from './turn-grants';
import { logError } from './logging';

/**
 * Shared prologue for /api/v1/service/* routes: verify the service credential,
 * validate the JSON body, and (when `needsGrant`) load the live turn grant for
 * the body's `session_key`. Returns either the parsed context or a response.
 */
export async function serviceRequest<T extends { session_key: string }>(
  request: NextRequest,
  schema: ZodSchema<T>,
  consequence: string,
  needsGrant: boolean,
): Promise<{ credential: ResolvedServiceCredential; body: T; grant: ActiveGrant | null } | { response: NextResponse }> {
  const auth = await verifyServiceCredential(request);
  if (!('success' in auth)) {
    return { response: NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status }) };
  }

  const raw = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      response: NextResponse.json(
        { error: `${consequence}: service sync / request validation - invalid request body`, code: 'VALIDATION_ERROR', details: parsed.error.errors },
        { status: 400 },
      ),
    };
  }

  if (!needsGrant) return { credential: auth.credential, body: parsed.data, grant: null };

  const grant = await findActiveGrant(auth.credential.id, parsed.data.session_key);
  if (!grant) {
    return {
      response: NextResponse.json(
        { error: `${consequence}: service sync / turn grant lookup - no live grant for this session key (expired, ended, or issued to another credential); request a new grant`, code: 'GRANT_REQUIRED' },
        { status: 403 },
      ),
    };
  }
  return { credential: auth.credential, body: parsed.data, grant };
}

export function serviceInternalError(consequence: string, moduleProcess: string, cause: string, error: unknown) {
  logError({ consequence, moduleProcess, cause, error });
  return NextResponse.json({ error: `${consequence}: ${moduleProcess} - ${cause}`, code: 'INTERNAL_ERROR' }, { status: 500 });
}
