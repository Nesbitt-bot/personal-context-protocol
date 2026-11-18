'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { SiteNav } from '@/components/site-nav';
import { readJsonResponse } from '@/lib/http';
import { diagnosticMessage, errorCause } from '@/lib/logging';
import { fetchSignedInUser, SignedInUser, uiAuthHeaders } from '@/lib/client-auth';
import type { BoardView, SortDir, TaskItem, TaskSortKey } from '@/lib/task-types';
import { BoardToolbar } from '@/components/tasks/board/board-toolbar';
import { BoardGroups, BoardHeader, UNASSIGNED_GROUP_KEY } from '@/components/tasks/board/board-groups';
import { TaskRow } from '@/components/tasks/board/task-row';
import { isDescendant, siblingKey } from '@/components/tasks/board/forest';
import type { CreateProjectInput, DropZone, RowContext, ViewMode } from '@/components/tasks/board/types';

const PAGE_SIZE = 30;

type Selection = { kind: 'task'; id: string } | { kind: 'category'; id: string | null } | null;

function Pager({ total, page, pages, onPage }: { total: number; page: number; pages: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
      <span>{total} task{total === 1 ? '' : 's'}</span>
      <div className="flex items-center gap-2">
        <button className="rounded-md border border-slate-200 bg-white px-2 py-1 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" type="button"><ChevronLeft size={16} /></button>
        <span>{page} of {pages}</span>
        <button className="rounded-md border border-slate-200 bg-white px-2 py-1 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" type="button"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

/** The Asana-like sprint board: grouped/flat tasks with selection, inline edits and drag & drop. */
export default function ProjectsPage() {
  const router = useRouter();
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [board, setBoard] = useState<BoardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<TaskSortKey>('updated');
  const [dir, setDir] = useState<SortDir>('desc');
  const [view, setView] = useState<ViewMode>('list');
  const [page, setPage] = useState(1);
  const [archivedPage, setArchivedPage] = useState(1);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);

  const load = useCallback(async (sortKey: TaskSortKey, dirValue: SortDir) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/tasks?sort=${encodeURIComponent(sortKey)}&dir=${encodeURIComponent(dirValue)}`, { headers: uiAuthHeaders(), cache: 'no-store' });
      const data = await readJsonResponse(res, { consequence: 'Unable to load tasks', moduleProcess: 'tasks board / list request', fallbackCause: 'tasks endpoint did not return JSON' });
      if (!res.ok || data.error) {
        setError(data.error || 'Unable to load tasks: tasks board / list request - request was rejected');
        return;
      }
      setBoard(data as BoardView);
      setError('');
    } catch (err) {
      setError(diagnosticMessage({ consequence: 'Unable to load tasks', moduleProcess: 'tasks board / list request', cause: errorCause(err) }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const u = await fetchSignedInUser();
      if (cancelled) return;
      if (!u) {
        window.location.replace('/login?next=/projects');
        return;
      }
      setUser(u);
      if (!u.is_admin) return;
      void load('updated', 'desc');
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function mutate(url: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown, consequence: string): Promise<boolean> {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...uiAuthHeaders() },
        body: JSON.stringify(body),
      });
      const data = await readJsonResponse(res, { consequence, moduleProcess: 'tasks board / mutation', fallbackCause: 'task endpoint did not return JSON' });
      if (!res.ok || data.error) {
        setError(data.error || `${consequence}: tasks board / mutation - request was rejected`);
        return false;
      }
      setError('');
      await load(sort, dir);
      return true;
    } catch (err) {
      setError(diagnosticMessage({ consequence, moduleProcess: 'tasks board / mutation', cause: errorCause(err) }));
      return false;
    }
  }

  async function toggleCompleted(task: TaskItem) {
    await mutate(`/api/v1/tasks/${encodeURIComponent(task.id)}`, 'PATCH', { completed: !task.completed }, 'Unable to update task');
  }

  async function renameTask(task: TaskItem, title: string) {
    await mutate(`/api/v1/tasks/${encodeURIComponent(task.id)}`, 'PATCH', { title }, 'Unable to update task');
  }

  async function setDue(task: TaskItem, due: string | null) {
    await mutate(`/api/v1/tasks/${encodeURIComponent(task.id)}`, 'PATCH', { due_at: due }, 'Unable to update task');
  }

  async function setPriority(task: TaskItem, priority: number | null) {
    await mutate(`/api/v1/tasks/${encodeURIComponent(task.id)}`, 'PATCH', { priority }, 'Unable to update task');
  }

  async function setProjects(task: TaskItem, projectIds: string[], primaryId: string | null) {
    await mutate(`/api/v1/tasks/${encodeURIComponent(task.id)}/projects`, 'PATCH', { project_ids: projectIds, primary_project_id: primaryId }, 'Unable to set task projects');
  }

  async function createProject(input: CreateProjectInput): Promise<string | null> {
    try {
      const body: Record<string, unknown> = { display_name: input.name };
      if (input.remote) body.git_remotes = [input.remote];
      if (input.deviceId && input.deviceKind && input.directory) {
        body.workspace = { device_id: input.deviceId, device_kind: input.deviceKind, directory: input.directory };
      }
      const res = await fetch('/api/v1/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', ...uiAuthHeaders() }, body: JSON.stringify(body) });
      const data = await readJsonResponse(res, { consequence: 'Unable to create project', moduleProcess: 'tasks board / create project', fallbackCause: 'projects endpoint did not return JSON' });
      if (!res.ok || data.error) { setError(data.error || 'Unable to create project: tasks board / create project - request was rejected'); return null; }
      return data.project?.id ?? null;
    } catch (err) {
      setError(diagnosticMessage({ consequence: 'Unable to create project', moduleProcess: 'tasks board / create project', cause: errorCause(err) }));
      return null;
    }
  }

  async function addTask(title: string, opts: { topicId?: string | null; parentId?: string | null }) {
    const body: Record<string, unknown> = { title };
    if (opts.parentId) body.parent_id = opts.parentId;
    else if (opts.topicId) body.topic_id = opts.topicId;
    await mutate('/api/v1/tasks', 'POST', body, 'Unable to create task');
  }

  function addTaskUnderSelection() {
    if (selection?.kind === 'task') {
      const title = window.prompt('Subtask title');
      if (title === null) return;
      void addTask(title, { parentId: selection.id });
      return;
    }
    if (selection?.kind === 'category') {
      const title = window.prompt(`Task title${selection.id ? '' : ' (unassigned)'}`);
      if (title === null) return;
      void addTask(title, selection.id ? { topicId: selection.id } : {});
      return;
    }
    const title = window.prompt('Task title');
    if (title === null) return;
    void addTask(title, {});
  }

  function addCategory() {
    const title = window.prompt('Category title');
    if (title === null) return;
    void mutate('/api/v1/topics', 'POST', { title }, 'Unable to create category');
  }

  async function renameCategory(categoryId: string, title: string) {
    await mutate(`/api/v1/topics/${encodeURIComponent(categoryId)}/rename`, 'POST', { title }, 'Unable to rename category');
  }

  function toggleSelect(sel: Selection) {
    setSelection((prev) => (prev?.kind === sel?.kind && prev?.id === sel?.id ? null : sel));
  }

  function openTask(task: TaskItem) {
    setSelection({ kind: 'task', id: task.id });
    router.push(`/tasks/${encodeURIComponent(task.id)}`);
  }

  function handleDragStart(task: TaskItem) {
    setDraggedId(task.id);
  }

  function handleDragEnd() {
    setDraggedId(null);
  }

  async function handleDropCategory(dragged: string, categoryId: string | null) {
    const task = board?.tasks.find((t) => t.id === dragged);
    if (!task) return;
    if (task.topic_id === categoryId && task.parent_id === null) return;
    await mutate(`/api/v1/tasks/${encodeURIComponent(dragged)}`, 'PATCH', { topic_id: categoryId, parent_id: null }, 'Unable to update task');
  }

  async function handleDropOnTask(dragged: string, target: TaskItem, zone: DropZone) {
    if (dragged === target.id || !board) return;
    if (isDescendant(board.tasks, dragged, target.id)) return;
    const source = board.tasks.find((t) => t.id === dragged);
    if (!source) return;

    if (zone === 'child') {
      if (source.parent_id === target.id) return;
      await mutate(`/api/v1/tasks/${encodeURIComponent(dragged)}`, 'PATCH', { parent_id: target.id }, 'Unable to update task');
      return;
    }

    const targetKey = siblingKey(target);
    if (siblingKey(source) !== targetKey) {
      const patch = target.parent_id
        ? { parent_id: target.parent_id }
        : { topic_id: target.topic_id, parent_id: null as string | null };
      await mutate(`/api/v1/tasks/${encodeURIComponent(dragged)}`, 'PATCH', patch, 'Unable to update task');
      return;
    }

    const siblings = board.tasks.filter((t) => siblingKey(t) === targetKey && t.id !== dragged);
    const idx = siblings.findIndex((t) => t.id === target.id);
    if (idx < 0) return;
    const neighbor = zone === 'before' ? siblings[idx - 1] : siblings[idx + 1];
    const position = neighbor ? (neighbor.position + target.position) / 2 : target.position + (zone === 'before' ? -1 : 1);
    if (position === source.position) return;
    await mutate(`/api/v1/tasks/${encodeURIComponent(dragged)}`, 'PATCH', { position }, 'Unable to update task');
  }

  function handleToggleCollapsed(task: TaskItem) {
    setCollapsed((prev) => ({ ...prev, [task.id]: !prev[task.id] }));
  }

  function handleSortChange(sortKey: TaskSortKey, dirValue: SortDir) {
    setSort(sortKey);
    setDir(dirValue);
    setPage(1);
    setArchivedPage(1);
    void load(sortKey, dirValue);
  }

  function handleViewChange(v: ViewMode) {
    setView(v);
    setPage(1);
    setArchivedPage(1);
  }

  async function handleRenameBoard(name: string) {
    await mutate('/api/v1/tasks/board', 'PATCH', { name }, 'Unable to rename board');
  }

  const tasks = board?.tasks ?? [];
  const activeTasks = tasks.filter((t) => !t.completed);
  const archivedTasks = tasks.filter((t) => t.completed);

  const activePages = Math.max(1, Math.ceil(activeTasks.length / PAGE_SIZE));
  const activeSafePage = Math.min(Math.max(1, page), activePages);
  const activePageTasks = activeTasks.slice((activeSafePage - 1) * PAGE_SIZE, activeSafePage * PAGE_SIZE);

  const archivedPages = Math.max(1, Math.ceil(archivedTasks.length / PAGE_SIZE));
  const archivedSafePage = Math.min(Math.max(1, archivedPage), archivedPages);
  const archivedPageTasks = archivedTasks.slice((archivedSafePage - 1) * PAGE_SIZE, archivedSafePage * PAGE_SIZE);

  const selectedId = selection?.kind === 'task' ? selection.id : null;
  const selectedKey = selection?.kind === 'category' ? (selection.id ?? UNASSIGNED_GROUP_KEY) : null;

  const ctx: RowContext = {
    projects: board?.projects ?? [],
    grouped: view !== 'list',
    draggedId,
    onToggleCompleted: toggleCompleted,
    onRename: renameTask,
    onSetDue: setDue,
    onSetPriority: setPriority,
    onSetProjects: setProjects,
    onCreateProject: createProject,
    onSelect: (task) => toggleSelect({ kind: 'task', id: task.id }),
    onOpen: openTask,
    onToggleCollapsed: handleToggleCollapsed,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onDropOnTask: handleDropOnTask,
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <SiteNav />
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {!user ? (
          <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 size={16} className="animate-spin" /> Loading board...
          </p>
        ) : !user.is_admin ? (
          <div className="rounded-md border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h1 className="text-lg font-semibold">This board is available to PCP admins.</h1>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">{error}</div>
            )}
            {loading && !board ? (
              <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <Loader2 size={16} className="animate-spin" /> Loading tasks...
              </p>
            ) : board ? (
              <div className="flex items-start">
                <div className="min-w-0 flex-1">
                  <BoardToolbar
                    boardName={board.board.name}
                    view={view}
                    sort={sort}
                    dir={dir}
                    onRenameBoard={handleRenameBoard}
                    onAddCategory={addCategory}
                    onAddTask={addTaskUnderSelection}
                    onViewChange={handleViewChange}
                    onSortChange={handleSortChange}
                  />
                  {tasks.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">No tasks yet.</p>
                  ) : (
                    <>
                      <BoardHeader />
                      <div className="space-y-1">
                        {view === 'list' ? (
                          activeTasks.length === 0 ? (
                            <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">No active tasks.</p>
                          ) : (
                            activePageTasks.map((t) => <TaskRow key={t.id} {...ctx} task={t} depth={0} collapsed={false} selected={selectedId === t.id} />)
                          )
                        ) : (
                          <BoardGroups
                            view={view}
                            pageTasks={activeTasks}
                            allTasks={activeTasks}
                            categories={board.categories}
                            collapsedMap={collapsed}
                            selectedId={selectedId}
                            selectedKey={selectedKey}
                            ctx={ctx}
                            onSelectCategory={(categoryId) => toggleSelect({ kind: 'category', id: categoryId })}
                            onRenameCategory={renameCategory}
                            onDropCategory={handleDropCategory}
                          />
                        )}
                      </div>
                      {view === 'list' && <Pager total={activeTasks.length} page={activeSafePage} pages={activePages} onPage={setPage} />}

                      {archivedTasks.length > 0 && (
                        <details className="mt-6 rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                            Archived ({archivedTasks.length})
                          </summary>
                          <div className="p-3 pt-1">
                            <BoardHeader />
                            <div className="space-y-1">
                              {view === 'list' ? (
                                archivedPageTasks.map((t) => <TaskRow key={t.id} {...ctx} task={t} depth={0} collapsed={false} selected={selectedId === t.id} />)
                              ) : (
                                <BoardGroups
                                  view={view}
                                  pageTasks={archivedTasks}
                                  allTasks={archivedTasks}
                                  categories={board.categories}
                                  collapsedMap={collapsed}
                                  selectedId={selectedId}
                                  selectedKey={selectedKey}
                                  ctx={ctx}
                                  onSelectCategory={(categoryId) => toggleSelect({ kind: 'category', id: categoryId })}
                                  onRenameCategory={renameCategory}
                                  onDropCategory={handleDropCategory}
                                />
                              )}
                            </div>
                            {view === 'list' && <Pager total={archivedTasks.length} page={archivedSafePage} pages={archivedPages} onPage={setArchivedPage} />}
                          </div>
                        </details>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
