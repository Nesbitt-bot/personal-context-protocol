import { NextRequest, NextResponse } from 'next/server';
import { authenticateUi, authErrorResponse, requireAdmin } from '@/lib/ui-auth';
import { boundedText } from '@/lib/bounded-body';
import { searchProjectTags, searchTaskNames, searchSessionContent } from '@/lib/search-catalog';
import { isSearchScope, type SearchCategory, type SearchCounts, type SearchResults } from '@/lib/search-options';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const auth = await authenticateUi(request);
  if ('error' in auth) return authErrorResponse(auth);
  const body = await boundedText(request, 8192).then(text => JSON.parse(text)).catch(() => null);
  const q = typeof body?.q === 'string' ? body.q.trim() : '';
  const scope: unknown = body?.scope ?? 'sessions';
  const mode = body?.mode ?? 'hybrid';
  if (!q || q.includes('\0') || q.length > 500 || !isSearchScope(scope) || !['keyword', 'hybrid'].includes(mode)) {
    return NextResponse.json({ error: 'Unable to search: enter 1–500 characters and choose a valid search scope and mode.' }, { status: 400 });
  }
  if (scope === 'tasks') {
    const denied = requireAdmin(auth.actor, 'Unable to search task names');
    if (denied) return authErrorResponse(denied);
  }
  const selected = (category: SearchCategory) => scope === 'all' || scope === category;
  const categoryErrors: Partial<Record<SearchCategory, string>> = {};
  async function read<T>(category: SearchCategory, operation: Promise<T>, message: string) {
    try { return await operation; }
    catch { categoryErrors[category] = message; }
  }
  const [projects, tasks, session] = await Promise.all([
    read('projects', searchProjectTags(q, auth.actor, selected('projects')), 'Unable to search project tags: the database could not be queried.'),
    auth.actor.isAdmin ? read('tasks', searchTaskNames(q, auth.actor, selected('tasks')), 'Unable to search task names: the database could not be queried.') : undefined,
    read('sessions', searchSessionContent(q, auth.actor, mode, selected('sessions')), 'Unable to search sessions: the session index or database could not be queried.'),
  ]);
  const counts: SearchCounts = { projects: projects?.total ?? null, sessions: session?.total ?? null, all: null };
  if (auth.actor.isAdmin) counts.tasks = tasks?.total ?? null;
  if (counts.projects !== null && counts.sessions !== null && counts.tasks !== null) {
    counts.all = counts.projects + counts.sessions + (counts.tasks ?? 0);
  }
  const data: SearchResults = {
    counts, projects: projects?.hits, tasks: tasks?.hits, results: session?.results, semantic: session?.semantic,
    canSearchTasks: auth.actor.isAdmin, sessionError: categoryErrors.sessions,
    categoryErrors: Object.keys(categoryErrors).length ? categoryErrors : undefined,
  };
  const error = scope === 'all' ? (!projects && !tasks && !session ? 'Unable to search: all categories are unavailable.' : undefined)
    : categoryErrors[scope];
  return NextResponse.json({ ...data, error }, { status: error ? 503 : 200, headers: { 'Cache-Control': 'private, no-store' } });
}
