import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { logError } from '@/lib/logging';
import { addTaskResource } from '@/lib/task-store';
import { addTaskResourceSchema } from '@/lib/task-validations';

export const dynamic = 'force-dynamic';

/** Add a bound resource (key doc, remote source, or local path). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const consequence = 'Unable to add resource';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const parsed = addTaskResourceSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: `${consequence}: task administration / request validation - invalid request body`, code: 'VALIDATION_ERROR', details: parsed.error.errors }, { status: 400 });
    }
    const resource = await addTaskResource(params.id, parsed.data, `human:${auth.actor.userId}`);
    return NextResponse.json({
      success: true,
      id: resource.id,
      title: resource.title,
      url: resource.url,
      kind: resource.kind,
      source: resource.source,
      created_at: resource.createdAt.toISOString(),
    }, { status: 201 });
  } catch (error) {
    logError({ consequence, moduleProcess: 'task administration / add resource', cause: 'resource insert failed', error });
    return NextResponse.json({ error: `${consequence}: task administration / add resource - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
