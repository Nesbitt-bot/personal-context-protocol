import { NextRequest, NextResponse } from 'next/server';
import { boundedText } from '@/lib/bounded-body';
import { isSearchScope } from '@/lib/search-options';
import { searchSuggestions } from '@/lib/search-suggestions';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const auth = await authenticateUi(request);
  if ('error' in auth) return authErrorResponse(auth);
  const body = await boundedText(request, 8192).then(s => JSON.parse(s)).catch(() => null);
  const q = typeof body?.q === 'string' ? body.q.trimStart() : '';
  const scope = body?.scope ?? 'all';
  if (!q || q.length > 500 || q.includes('\0') || !isSearchScope(scope)) {
    return NextResponse.json({ error: 'Unable to suggest keywords: enter 1–500 characters and a valid scope.' }, { status: 400 });
  }
  if (scope === 'tasks') {
    const denied = requireAdmin(auth.actor, 'Unable to suggest task names');
    if (denied) return authErrorResponse(denied);
  }
  try {
    return NextResponse.json({ suggestions: await searchSuggestions(q, scope, auth.actor) },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Keyword suggestions are unavailable: the search index or database could not be queried.' }, { status: 503 });
  }
}
