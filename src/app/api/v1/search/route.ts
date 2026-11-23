import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { boundedText } from '@/lib/bounded-body';
import { searchProjectTags, searchTaskNames, searchSessionContent } from '@/lib/search-catalog';
import { isSearchScope, type SearchResults } from '@/lib/search-options';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const auth = await authenticateUi(request);
  if ('error' in auth) return authErrorResponse(auth);
  const body = await boundedText(request, 8192).then(text => JSON.parse(text)).catch(() => null);
  const q = typeof body?.q === 'string' ? body.q.trim() : '';
  const scope = body?.scope ?? 'sessions';
  const mode = body?.mode ?? 'hybrid';
  if (!q || q.includes('\0') || q.length > 500 || !isSearchScope(scope) || !['keyword', 'hybrid'].includes(mode)) {
    return NextResponse.json({ error: 'Unable to search: enter 1–500 characters and choose a valid search scope and mode.' }, { status: 400 });
  }
  if (scope === 'tasks') {
    const denied = requireAdmin(auth.actor, 'Unable to search task names');
    if (denied) return authErrorResponse(denied);
  }
  try {
    const [projects, tasks, session] = await Promise.all([
      scope === 'all' || scope === 'projects' ? searchProjectTags(q, auth.actor) : undefined,
      (scope === 'all' || scope === 'tasks') && auth.actor.isAdmin ? searchTaskNames(q, auth.actor) : undefined,
      scope === 'all' || scope === 'sessions' ? searchSessionContent(q, auth.actor, mode).catch(() => ({
        sessionError: 'Unable to search sessions: the session index or database could not be queried.',
      })) : undefined,
    ]);
    const data: SearchResults = { projects, tasks, ...session, canSearchTasks: auth.actor.isAdmin };
    return NextResponse.json(data.sessionError && scope === 'sessions' ? { error: data.sessionError } : data, {
      status: data.sessionError && scope === 'sessions' ? 503 : 200, headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'Unable to search: the project or task database could not be queried.' }, { status: 503 });
  }
}
