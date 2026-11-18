'use client';

import { useEffect, useRef, useState } from 'react';
import { Archive, Check, ClipboardPaste, KeyRound, Lock, RotateCcw, Settings2, Shield, ShieldAlert } from 'lucide-react';
import { Modal } from '@/components/modal';
import { ImportPanel } from './import-panel';
import { MessageList } from './message-list';
import { CompactionList } from './compaction-list';
import { ImportExportPanel } from './import-export-panel';
import { EventLog, Message, Session, Topic } from './types';

function relativeTime(value: string | null | undefined, now: number): string {
  if (!value) return 'never';
  const ms = now - new Date(value).getTime();
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? '' : 's'} ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function formatCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

function linkStorageKey(sessionId: string): string {
  return `pcp_access_link_${sessionId}`;
}

interface SessionWorkspaceProps {
  error: string;
  status: string;
  hasUiToken: boolean;
  uiTokenInput: string;
  selectedTopic: Topic | null;
  selectedSession: Session | null;
  topics: Topic[];
  sessions: Session[];
  messages: Message[];
  events: EventLog[];
  editingSession: boolean;
  editTitle: string;
  editTopicId: string;
  onUiTokenInputChange: (token: string) => void;
  onSaveUiToken: () => void;
  onStartEditSession: () => void;
  onEditTitleChange: (title: string) => void;
  onEditTopicIdChange: (topicId: string) => void;
  onSaveSessionEdits: () => void;
  onCancelSessionEdits: () => void;
  onArchiveSelectedSession: () => void;
  onRestoreSelectedSession: () => void;
  onSetMode: (session: Session, mode: 'wild' | 'exact' | 'locked') => void;
  onCopyMcpPrompt: (session: Session) => void;
  onCreateAccessLink: (session: Session) => Promise<{ url: string; expires_at: string } | null>;
  onImported: () => void;
}

const ICON_BTN = 'inline-flex items-center justify-center rounded-md border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800';

/**
 * The right-side session view: a compact two-row header (title + live last
 * activity, then mode toggle + sync status + key/clipboard/gear actions), and
 * the message body below. Popups open in the page center.
 */
export function SessionWorkspace({
  error,
  status,
  hasUiToken,
  uiTokenInput,
  selectedTopic,
  selectedSession,
  topics,
  sessions,
  messages,
  events,
  editingSession,
  editTitle,
  editTopicId,
  onUiTokenInputChange,
  onSaveUiToken,
  onStartEditSession,
  onEditTitleChange,
  onEditTopicIdChange,
  onSaveSessionEdits,
  onCancelSessionEdits,
  onArchiveSelectedSession,
  onRestoreSelectedSession,
  onSetMode,
  onCopyMcpPrompt,
  onCreateAccessLink,
  onImported,
}: SessionWorkspaceProps) {
  const [now, setNow] = useState(() => Date.now());
  const [compactionCount, setCompactionCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [accessLink, setAccessLink] = useState<{ url: string; expires_at: string } | null>(null);
  const [linking, setLinking] = useState(false);
  const [historySessionId, setHistorySessionId] = useState<string | null>(null);
  const [historyEvents, setHistoryEvents] = useState<EventLog[] | null>(null);
  const importRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCompactionCount(0);
    const link = selectedSession ? loadLink(selectedSession.id) : null;
    setAccessLink(link);
  }, [selectedSession?.id]);

  function loadLink(sessionId: string): { url: string; expires_at: string } | null {
    try {
      const raw = localStorage.getItem(linkStorageKey(sessionId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.url === 'string' && typeof parsed.expires_at === 'string') return parsed;
    } catch {
      // ignore malformed storage
    }
    return null;
  }

  function saveLink(sessionId: string, link: { url: string; expires_at: string }) {
    try {
      localStorage.setItem(linkStorageKey(sessionId), JSON.stringify(link));
    } catch {
      // ignore storage failures
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  function handleChanged() {
    onImported();
    setRefreshKey((key) => key + 1);
  }

  async function generateLink() {
    if (!selectedSession) return;
    setLinking(true);
    const link = await onCreateAccessLink(selectedSession);
    setLinking(false);
    if (link) {
      setAccessLink(link);
      saveLink(selectedSession.id, link);
    }
  }

  const siblings = selectedSession?.task_id ? sessions.filter((s) => s.task_id === selectedSession.task_id) : [];

  async function openHistory(sessionId: string) {
    setHistorySessionId(sessionId);
    setHistoryEvents(null);
    try {
      const res = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/events`);
      const data = await res.json().catch(() => ({}));
      setHistoryEvents(Array.isArray(data.events) ? data.events : []);
    } catch {
      setHistoryEvents([]);
    }
  }

  const mode = (selectedSession?.mode as 'wild' | 'exact' | 'locked') || 'wild';
  const recordingUrl = selectedSession ? `${window.location.origin}/r/${selectedSession.id}` : '';
  const linkSecondsLeft = accessLink ? Math.max(0, Math.floor((new Date(accessLink.expires_at).getTime() - now) / 1000)) : 0;

  function scrollToImport() {
    importRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <section className="min-h-0 min-w-0 bg-white dark:bg-slate-950">
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <header className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          {error && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
          {status && <div className="mb-3 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"><Check size={16} /><span>{status}</span></div>}

          {!hasUiToken && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/40">
              <label className="mb-2 block text-sm font-medium text-amber-900 dark:text-amber-200">UI token</label>
              <div className="flex gap-2">
                <input className="min-w-0 flex-1 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:ring-2 focus:ring-amber-200 dark:border-amber-900/60 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-amber-950" value={uiTokenInput} onChange={(e) => onUiTokenInputChange(e.target.value)} placeholder="Paste setup token" />
                <button className="rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-800 dark:bg-amber-300 dark:text-slate-950" onClick={onSaveUiToken} type="button">Save</button>
              </div>
            </div>
          )}

          {selectedSession ? (
            <>
              {/* Row 1: title (left), live last activity (right). */}
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="min-w-0 truncate text-xl font-semibold text-slate-950 dark:text-white" title={selectedSession.title}>
                  {selectedSession.title}
                </h2>
                <button
                  className="shrink-0 text-sm text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-300"
                  onClick={() => { setHistorySessionId(selectedSession.id); setHistoryOpen(true); }}
                  title="Session history"
                  type="button"
                >
                  {relativeTime(selectedSession.last_message_at, now)}
                </button>
              </div>

              {/* Row 2: mode toggle + sync status (left), key/clipboard/gear (right). */}
              <div className="mt-2 flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 p-0.5 text-xs dark:border-slate-700">
                    <button className={`inline-flex items-center gap-1 rounded px-2 py-1 ${mode === 'wild' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`} onClick={() => onSetMode(selectedSession, 'wild')} type="button" title="Wild: the agent may redact credentials/secrets">Wild</button>
                    <button className={`inline-flex items-center gap-1 rounded px-2 py-1 ${mode === 'exact' ? 'bg-amber-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`} onClick={() => onSetMode(selectedSession, 'exact')} type="button" title="Exact: record everything verbatim, including credentials">Exact</button>
                    <button className={`inline-flex items-center gap-1 rounded px-2 py-1 ${mode === 'locked' ? 'bg-slate-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`} onClick={() => onSetMode(selectedSession, 'locked')} type="button" title="Locked: the session is read-only">Locked</button>
                  </div>
                  <span className="hidden min-w-0 truncate text-xs text-slate-400 dark:text-slate-500 sm:inline">
                    {mode === 'locked'
                      ? 'Read-only — remote sync is locked.'
                      : selectedSession.device_id
                        ? `Synced from ${selectedSession.device_id}${selectedSession.agent_name ? ` · ${selectedSession.agent_name}` : ''}`
                        : 'Local session — not synced with a remote device.'}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button className={`${ICON_BTN} ${accessLink && linkSecondsLeft > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`} onClick={() => setConnectOpen(true)} type="button" title="Connection URL">
                    <KeyRound size={16} />
                  </button>
                  {accessLink && linkSecondsLeft > 0 && (
                    <span className="text-xs font-medium tabular-nums text-emerald-600 dark:text-emerald-400" title="Temporary link time remaining">{formatCountdown(linkSecondsLeft)}</span>
                  )}
                  <button className={ICON_BTN} onClick={scrollToImport} type="button" title="Paste from fallback block">
                    <ClipboardPaste size={16} />
                  </button>
                  <button className={ICON_BTN} onClick={() => setSettingsOpen(true)} type="button" title="Session settings">
                    <Settings2 size={16} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">Select or create a session to view messages.</div>
          )}
        </header>

        {editingSession && selectedSession && (
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Session title</span>
                <input className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-950" value={editTitle} onChange={(e) => onEditTitleChange(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Topic</span>
                <select className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-950" value={editTopicId} onChange={(e) => onEditTopicIdChange(e.target.value)}>
                  <option value="">Uncategorized (no topic)</option>
                  {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
                </select>
              </label>
              <div className="flex gap-2">
                <button className="rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300" onClick={onSaveSessionEdits} type="button">Save</button>
                <button className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-white dark:border-slate-700 dark:hover:bg-slate-800" onClick={onCancelSessionEdits} type="button">Cancel</button>
              </div>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden px-5 pt-5">
          {selectedSession && (
            <div className="flex h-full min-h-0 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto pb-3">
                <MessageList sessionId={selectedSession.id} messages={messages} onChanged={handleChanged} hasCompactions={compactionCount > 0} />
                <CompactionList key={`${selectedSession.id}:${refreshKey}`} sessionId={selectedSession.id} onLoaded={setCompactionCount} />
                <ImportExportPanel sessionId={selectedSession.id} sessionTitle={selectedSession.title} mode={(selectedSession.mode as 'wild' | 'exact' | 'locked') || 'wild'} messages={messages} onCopyMcpPrompt={() => onCopyMcpPrompt(selectedSession)} />
              </div>
              <div ref={importRef} className="shrink-0 border-t border-slate-200 pt-3 dark:border-slate-800">
                <ImportPanel sessionId={selectedSession.id} onImported={handleChanged} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* History popup: sibling sessions of this task + per-session operations log. */}
      {historyOpen && selectedSession && (
        <Modal title="Session history" onClose={() => setHistoryOpen(false)} widthClass="max-w-xl">
          <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Sessions</p>
              <ul className="space-y-1">
                {siblings.length === 0 && <li className="text-sm text-slate-500 dark:text-slate-400">No related sessions.</li>}
                {siblings.map((s) => (
                  <li key={s.id}>
                    <button
                      className={`flex w-full flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${historySessionId === s.id ? 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40' : 'border-transparent'}`}
                      onClick={() => openHistory(s.id)}
                      type="button"
                    >
                      <span className="truncate font-medium text-slate-800 dark:text-slate-100">{s.title}</span>
                      <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {s.device_id || 'unknown device'}{s.agent_name ? ` · ${s.agent_name}` : ''} · {relativeTime(s.last_message_at, now)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Operations</p>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {historyEvents === null ? <p className="text-sm text-slate-500 dark:text-slate-400">Select a session to view its operations.</p>
                  : historyEvents.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No operations recorded.</p>
                    : historyEvents.map((e) => (
                      <div key={e.id} className="rounded-md border border-slate-200 bg-white p-2 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-950">
                        <p className="font-medium text-slate-800 dark:text-slate-100">{e.action}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{e.actor} · {relativeTime(e.created_at || e.createdAt, now)}</p>
                      </div>
                    ))}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Connection popup: recording URL + temporary access link with live expiry. */}
      {connectOpen && selectedSession && (
        <Modal title="Connection" onClose={() => setConnectOpen(false)} widthClass="max-w-lg">
          <div className="space-y-4 px-5 py-4">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Recording URL</p>
              <code className="block break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950">{recordingUrl}</code>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Temporary access link</p>
              {accessLink && linkSecondsLeft > 0 ? (
                <>
                  <code className="block break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950">{accessLink.url}</code>
                  <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">Expires in {relativeTime(new Date(Date.now() + linkSecondsLeft * 1000).toISOString(), now).replace(' ago', '')} (max 24h).</p>
                </>
              ) : accessLink ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">The temporary link has expired. Generate a new one.</p>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">No temporary link yet.</p>
              )}
              <button className="mt-2 rounded-md border border-sky-200 bg-white px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:border-sky-900/60 dark:bg-slate-900 dark:text-sky-300" onClick={generateLink} disabled={linking} type="button">
                {linking ? 'Generating…' : 'Generate temporary link'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Settings popup (Apple-like grouped form). */}
      {settingsOpen && selectedSession && (
        <Modal title="Session settings" onClose={() => setSettingsOpen(false)} widthClass="max-w-lg">
          <div className="space-y-5 px-5 py-4">
            <div className="rounded-md border border-slate-200 dark:border-slate-700">
              <p className="border-b border-slate-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">Session</p>
              <div className="space-y-3 p-3">
                <label className="block">
                  <span className="mb-1 block text-sm text-slate-600 dark:text-slate-300">Title</span>
                  <input className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950" value={editTitle} onChange={(e) => onEditTitleChange(e.target.value)} onFocus={onStartEditSession} />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-sm text-slate-600 dark:text-slate-300">Category</span>
                    <select className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950" value={editTopicId} onChange={(e) => onEditTopicIdChange(e.target.value)} onFocus={onStartEditSession}>
                      <option value="">Uncategorized</option>
                      {topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm text-slate-600 dark:text-slate-300">Context mode</span>
                    <select className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950" value={mode} onChange={(e) => onSetMode(selectedSession, e.target.value as 'wild' | 'exact' | 'locked')}>
                      <option value="wild">Wild — ignore credentials</option>
                      <option value="exact">Exact — record everything</option>
                      <option value="locked">Locked — read-only</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-slate-200 dark:border-slate-700">
              <p className="border-b border-slate-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">Import / Export</p>
              <div className="p-3">
                <p className="text-sm text-slate-600 dark:text-slate-300">Use the temporary access link (key icon) to sync context with an agent, or paste a fallback block in the message area (clipboard icon).</p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              {selectedSession.archived ? (
                <button className="inline-flex items-center gap-2 rounded-md border border-emerald-200 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/60 dark:text-emerald-200 dark:hover:bg-emerald-950/40" onClick={() => { setSettingsOpen(false); onRestoreSelectedSession(); }} type="button"><RotateCcw size={14} /> Restore</button>
              ) : (
                <button className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-200 dark:hover:bg-red-950/40" onClick={() => { setSettingsOpen(false); onArchiveSelectedSession(); }} type="button"><Archive size={14} /> Delete session</button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
