'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, Loader2, Trash2 } from 'lucide-react';
import { readJsonResponse } from '@/lib/http';
import { diagnosticMessage, errorCause } from '@/lib/logging';
import { fetchSignedInUser, uiAuthHeaders } from '@/lib/client-auth';
import type { SignedInUser } from '@/lib/client-auth';
import { progressLabel } from '@/lib/task-types';
import type { TaskDetail } from '@/lib/task-types';
import { SessionsTable } from './sessions-table';
import { ResourcesPanel, type ResourceInput } from './resources-panel';
import { LinkSessionPanel } from './link-session-panel';
import { ProjectPicker } from './project-picker';
import { fromDateInputValue, toDateInputValue } from './format';

/**
 * The full Asana-style task detail (editable properties, sessions, resources).
 * Rendered both as a standalone page and inside the board's side panel; `onBack`
 * / `onDeleted` let the host decide how to leave or react to a deletion.
 */
export function TaskDetailView({ id, onBack, onDeleted }: { id: string; onBack?: () => void; onDeleted?: () => void }) {
  const router = useRouter();

  const [user, setUser] = useState<SignedInUser | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [turnsDraft, setTurnsDraft] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(id)}`, { headers: uiAuthHeaders(), cache: 'no-store' });
      const data = await readJsonResponse(res, { consequence: 'Unable to load task', moduleProcess: 'task detail view / detail request', fallbackCause: 'task endpoint did not return JSON' });
      if (!res.ok || data.error) { setError(data.error || 'Unable to load task: task detail view / detail request - request was rejected'); return; }
      setDetail(data as TaskDetail);
      setError('');
    } catch (err) {
      setError(diagnosticMessage({ consequence: 'Unable to load task', moduleProcess: 'task detail view / detail request', cause: errorCause(err) }));
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    fetchSignedInUser().then((u) => {
      if (cancelled) return;
      if (!u) { window.location.replace(`/login?next=${encodeURIComponent(`/tasks/${id}`)}`); return; }
      setUser(u);
      if (!u.is_admin) return;
      void load();
    });
    return () => { cancelled = true; };
  }, [load, id]);

  useEffect(() => {
    if (!detail) return;
    setDescriptionDraft(detail.task.description ?? '');
    setTurnsDraft(detail.task.expected_turns != null ? String(detail.task.expected_turns) : '');
  }, [detail]);

  async function mutate(url: string, method: string, body: unknown, consequence: string, moduleProcess: string, done: string): Promise<boolean> {
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...uiAuthHeaders() }, body: JSON.stringify(body) });
      const data = await readJsonResponse(res, { consequence, moduleProcess, fallbackCause: 'endpoint did not return JSON' });
      if (!res.ok || data.error) { setError(data.error || `${consequence}: ${moduleProcess} - request was rejected`); return false; }
      setStatus(done);
      await load();
      return true;
    } catch (err) {
      setError(diagnosticMessage({ consequence, moduleProcess, cause: errorCause(err) }));
      return false;
    }
  }

  async function patchTask(fields: Record<string, unknown>, done: string) {
    setBusy(true);
    await mutate(`/api/v1/tasks/${encodeURIComponent(id)}`, 'PATCH', fields, 'Unable to update task', 'task detail view / update task', done);
    setBusy(false);
  }

  async function saveTitle() {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === detail?.task.title) return;
    await patchTask({ title: next }, 'Task title updated.');
  }

  async function toggleCompleted() {
    if (!detail) return;
    const next = !detail.task.completed;
    await patchTask({ completed: next }, next ? 'Task completed.' : 'Task reopened.');
  }

  async function setPriority(value: string) {
    await patchTask({ priority: value === '' ? null : Number(value) }, 'Priority updated.');
  }

  async function saveExpectedTurns() {
    const trimmed = turnsDraft.trim();
    if (trimmed === '') {
      if (detail?.task.expected_turns != null) await patchTask({ expected_turns: null }, 'Expected turns cleared.');
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return;
    const next = Math.max(0, Math.floor(n));
    if (next === detail?.task.expected_turns) return;
    await patchTask({ expected_turns: next }, 'Expected turns updated.');
  }

  async function setDue(value: string) {
    if (!value) { await patchTask({ due_at: null }, 'Due date cleared.'); return; }
    await patchTask({ due_at: fromDateInputValue(value) }, 'Due date updated.');
  }

  async function saveDescription() {
    const next = descriptionDraft;
    if (next === (detail?.task.description ?? '')) return;
    await patchTask({ description: next }, 'Description updated.');
  }

  async function saveProjects(projectIds: string[], primaryId: string | null) {
    setBusy(true);
    const ok = await mutate(`/api/v1/tasks/${encodeURIComponent(id)}/projects`, 'PATCH', { project_ids: projectIds, primary_project_id: primaryId }, 'Unable to set task projects', 'task detail view / set projects', 'Projects updated.');
    setBusy(false);
    return ok;
  }

  async function addResource(input: ResourceInput) {
    setBusy(true);
    const ok = await mutate(`/api/v1/tasks/${encodeURIComponent(id)}/resources`, 'POST', input, 'Unable to add resource', 'task detail view / add resource', 'Resource added.');
    setBusy(false);
    return ok;
  }

  async function removeResource(resourceId: string) {
    setBusy(true);
    await mutate(`/api/v1/tasks/${encodeURIComponent(id)}/resources/${encodeURIComponent(resourceId)}`, 'DELETE', {}, 'Unable to remove resource', 'task detail view / remove resource', 'Resource removed.');
    setBusy(false);
  }

  async function linkSession(sessionId: string) {
    setBusy(true);
    const ok = await mutate(`/api/v1/tasks/${encodeURIComponent(id)}/sessions`, 'POST', { session_id: sessionId }, 'Unable to link session', 'task detail view / link session', 'Session linked.');
    setBusy(false);
    return ok;
  }

  async function unlinkSession(sessionId: string) {
    setBusy(true);
    await mutate(`/api/v1/tasks/${encodeURIComponent(id)}/sessions/${encodeURIComponent(sessionId)}`, 'DELETE', {}, 'Unable to unlink session', 'task detail view / unlink session', 'Session unlinked.');
    setBusy(false);
  }

  async function generateLink(sessionId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/access-code`, { method: 'POST', headers: uiAuthHeaders() });
      const data = await readJsonResponse(res, { consequence: 'Unable to create access link', moduleProcess: 'task detail view / create access link', fallbackCause: 'access-code endpoint did not return JSON' });
      if (!res.ok || data.error) { setError(data.error || 'Unable to create access link: task detail view / create access link - request was rejected'); return; }
      await navigator.clipboard.writeText(data.url);
      setStatus('Temporary access link copied. It is valid for 1h idle / 24h max.');
    } catch (err) {
      setError(diagnosticMessage({ consequence: 'Unable to create access link', moduleProcess: 'task detail view / create access link', cause: errorCause(err) }));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTask() {
    if (!detail) return;
    if (!window.confirm(`Delete task "${detail.task.title}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/tasks/${encodeURIComponent(id)}`, { method: 'DELETE', headers: uiAuthHeaders() });
      const data = await readJsonResponse(res, { consequence: 'Unable to delete task', moduleProcess: 'task detail view / delete task', fallbackCause: 'task endpoint did not return JSON' });
      if (!res.ok || data.error) { setError(data.error || 'Unable to delete task: task detail view / delete task - request was rejected'); return; }
      if (onDeleted) onDeleted();
      else router.push('/projects');
    } catch (err) {
      setError(diagnosticMessage({ consequence: 'Unable to delete task', moduleProcess: 'task detail view / delete task', cause: errorCause(err) }));
    } finally {
      setBusy(false);
    }
  }

  const task = detail?.task;
  const progressPct = task?.progress;

  return (
    <div className="space-y-6">
      <div>
        {onBack ? (
          <button className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline dark:text-slate-400" onClick={onBack} type="button"><ArrowLeft size={14} /> Back</button>
        ) : (
          <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline dark:text-slate-400"><ArrowLeft size={14} /> Board</Link>
        )}
      </div>
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
      {status && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">{status}</div>}
      {user && !user.is_admin && <p className="text-sm text-slate-600 dark:text-slate-400">This task view is available to PCP admins.</p>}
      {!task && !error && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading task...</p>}
      {task && detail && (
        <>
          <header className="space-y-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                {editingTitle ? (
                  <input
                    autoFocus
                    className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-2xl font-semibold outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                      else if (e.key === 'Escape') { setTitleDraft(task.title); setEditingTitle(false); }
                    }}
                  />
                ) : (
                  <h1 className="cursor-text break-words text-2xl font-semibold" title="Click to rename" onClick={() => { setTitleDraft(task.title); setEditingTitle(true); }}>{task.title}</h1>
                )}
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {task.topic_title ? <>In {task.topic_title} · </> : <>Unassigned · </>}
                  {task.subtask_count} subtask{task.subtask_count === 1 ? '' : 's'}
                </p>
              </div>
              <button
                type="button"
                onClick={toggleCompleted}
                disabled={busy}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-50 ${task.completed ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'}`}
              >
                <Check size={13} className={task.completed ? '' : 'opacity-40'} /> {task.completed ? 'Completed' : 'Open'}
              </button>
            </div>

            <div>
              <p className="text-sm text-slate-700 dark:text-slate-200">
                Progress: <span className="font-medium">{task.current_turns}</span> / {task.expected_turns ?? '—'} turns{progressLabel(task) && <span className="text-slate-500 dark:text-slate-400"> ({progressLabel(task)})</span>}
              </p>
              {progressPct != null && (
                <div className="mt-1.5 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.min(100, Math.max(0, Math.round(progressPct * 100)))}%` }} />
                </div>
              )}
            </div>

            <div className="grid gap-4 rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Priority</span>
                <select className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900" value={task.priority ?? ''} onChange={(e) => setPriority(e.target.value)} disabled={busy}>
                  <option value="">—</option>
                  <option value={0}>0 · highest</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3 · lowest</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Expected turns</span>
                <input
                  type="number"
                  min={0}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900"
                  value={turnsDraft}
                  placeholder="—"
                  onChange={(e) => setTurnsDraft(e.target.value)}
                  onBlur={saveExpectedTurns}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Due</span>
                <input
                  type="date"
                  className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900"
                  value={toDateInputValue(task.due_at)}
                  onChange={(e) => setDue(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Description</span>
                <textarea
                  rows={3}
                  className="resize-y rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-900"
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  onBlur={saveDescription}
                  placeholder="No description."
                />
              </label>
            </div>
          </header>

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Projects</h2>
            <ProjectPicker task={task} projects={detail.projects} onSave={saveProjects} busy={busy} />
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Sessions ({detail.sessions.length})</h2>
            <SessionsTable sessions={detail.sessions} onUnlink={unlinkSession} onGenerateLink={generateLink} busy={busy} />
            <div className="mt-3">
              <LinkSessionPanel onLink={linkSession} busy={busy} />
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Resources ({detail.resources.length})</h2>
            <ResourcesPanel resources={detail.resources} onAdd={addResource} onRemove={removeResource} busy={busy} />
          </section>

          <footer className="flex justify-end border-t border-slate-200 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={deleteTask}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/40"
            >
              <Trash2 size={14} /> Delete task
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
