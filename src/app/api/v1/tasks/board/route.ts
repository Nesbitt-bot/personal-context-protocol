import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { logError } from '@/lib/logging';
import { ensureBoard, setBoardName } from '@/lib/task-store';
import { boardNameSchema } from '@/lib/task-validations';

export const dynamic = 'force-dynamic';

/** The single board's name. */
export async function GET(request: NextRequest) {
  const consequence = 'Unable to read board';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const board = await ensureBoard();
    return NextResponse.json({ board: { id: board.id, name: board.name } });
  } catch (error) {
    logError({ consequence, moduleProcess: 'task administration / read board', cause: 'board query failed', error });
    return NextResponse.json({ error: `${consequence}: task administration / read board - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/** Rename the board. */
export async function PATCH(request: NextRequest) {
  const consequence = 'Unable to rename board';
  try {
    const auth = await authenticateUi(request);
    if ('error' in auth) return authErrorResponse(auth);
    const denied = requireAdmin(auth.actor, consequence);
    if (denied) return authErrorResponse(denied);
    const parsed = boardNameSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: `${consequence}: task administration / request validation - invalid request body`, code: 'VALIDATION_ERROR', details: parsed.error.errors }, { status: 400 });
    }
    const board = await setBoardName(parsed.data.name, `human:${auth.actor.userId}`);
    return NextResponse.json({ board: { id: board.id, name: board.name } });
  } catch (error) {
    logError({ consequence, moduleProcess: 'task administration / rename board', cause: 'board update failed', error });
    return NextResponse.json({ error: `${consequence}: task administration / rename board - internal error occurred`, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
