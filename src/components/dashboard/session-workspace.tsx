'use client';

import { useEffect, useState } from 'react';
import { Archive, Check, ChevronLeft, ChevronRight, Edit3, Globe, KeyRound, ListChecks, Lock, RotateCcw, Settings2, Shield, ShieldAlert } from 'lucide-react';
import { formatDate } from './format';
import { ImportPanel } from './import-panel';
import { MessageList } from './message-list';
import { CompactionList } from './compaction-list';
import { TokenDisplay } from './token-display';
import { EventLog, Message, Session, Topic } from './types';

interface SessionWorkspaceProps {
  error: string;
  status: string;
  hasUiToken: boolean;
  uiTokenInput: string;
  selectedTopic: Topic | null;
  selectedSession: Session | null;
  topics: Topic[];
  messages: Message[];
  events: EventLog[];
  editingSession: boolean;
  editTitle: string;
  editTopicId: string;
  generatedToken: string;
  onClearGeneratedToken: () => void;
  onUiTokenInputChange: (token: string) => void;
  onSaveUiToken: () => void;
  onStartEditSession: () => void;
  onEditTitleChange: (title: string) => void;
  onEditTopicIdChange: (topicId: string) => void;
  onSaveSessionEdits: () => void;
  onCancelSessionEdits: () => void;
  onArchiveSelectedSession: () => void;
  onRestoreSelectedSession: () => void;
  onGenerateToken: (session: Session) => void;
  onCreateImportToken: (session: Session) => void;
  onCreateExportToken: (session: Session) => void;
  onManageTokens: (session: Session) => void;
  onTogglePublic: (session: Session, next: boolean) => void;
  onSetMode: (session: Session, mode: 'wild' | 'exact') => void;
  onImported: () => void;
  eventsOpen?: boolean;
  onToggleEvents?: () => void;
}

/**
 * SessionWorkspace renders the right-side working area for the selected session.
 * It receives callbacks for all mutations so it does not own API state.
 */
export function SessionWorkspace({
  error,
  status,
  hasUiToken,
  uiTokenInput,
  selectedTopic,
  selectedSession,
  topics,
  messages,
  events,
  editingSession,
  editTitle,
  editTopicId,
  generatedToken,
  onClearGeneratedToken,
  onUiTokenInputChange,
  onSaveUiToken,
  onStartEditSession,
  onEditTitleChange,
  onEditTopicIdChange,
  onSaveSessionEdits,
  onCancelSessionEdits,
  onArchiveSelectedSession,
  onRestoreSelectedSession,
  onGenerateToken,
  onCreateImportToken,
  onCreateExportToken,
  onManageTokens,
  onTogglePublic,
  onSetMode,
  onImported,
  eventsOpen = false,
  onToggleEvents,
}: SessionWorkspaceProps) {
  const [copiedPublic, setCopiedPublic] = useState(false);
  const [compactionCount, setCompactionCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tokenDisplay, setTokenDisplay] = useState('');

  useEffect(() => {
    setCompactionCount(0);
  }, [selectedSession?.id]);

  // Reload messages/events (parent) and refetch compactions after a change.
  function handleChanged() {
    onImported();
    setRefreshKey((key) => key + 1);
  }

  function copyPublicLink(sessionId: string) {
    const url = `${window.location.origin}/s/${sessionId}`;
    navigator.clipboard.writeText(url).catch(() => undefined);
    setCopiedPublic(true);
    window.setTimeout(() => setCopiedPublic(false), 1500);
  }
  return (
    <section className="min-w-0 bg-white dark:bg-slate-950">
      <div className="flex h-full flex-col overflow-hidden">
        <header className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </div>
          )}
          {status && (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
              <Check size={16} />
              <span>{status}</span>
            </div>
          )}

          {!hasUiToken && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/40">
              <label className="mb-2 block text-sm font-medium text-amber-900 dark:text-amber-200">UI token</label>
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:ring-2 focus:ring-amber-200 dark:border-amber-900/60 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-amber-950"
                  value={uiTokenInput}
                  onChange={(event) => onUiTokenInputChange(event.target.value)}
                  placeholder="Paste setup token"
                />
                <button className="rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-800 dark:bg-amber-300 dark:text-slate-950" onClick={onSaveUiToken} type="button">
                  Save
                </button>
              </div>
            </div>
          )}

          {selectedSession ? (
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <span>{selectedTopic?.title || 'Uncategorized'}</span>
                  {selectedSession.archived && <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">Archived</span>}
                </div>
                <h2 className="truncate text-2xl font-semibold text-slate-950 dark:text-white">{selectedSession.title}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">Last activity: {formatDate(selectedSession.last_message_at)}</p>
                <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-200 p-0.5 text-xs dark:border-slate-700" title="Recording mode the agent is told to honor">
                  <button
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 ${(selectedSession.mode ?? 'wild') === 'wild' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                    onClick={() => onSetMode(selectedSession, 'wild')}
                    type="button"
                    title="Wild: the agent may redact secrets/credentials it judges unsafe"
                  >
                    <Shield size={13} /> Wild
                  </button>
                  <button
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 ${selectedSession.mode === 'exact' ? 'bg-amber-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                    onClick={() => onSetMode(selectedSession, 'exact')}
                    type="button"
                    title="Exact: the agent records verbatim, including credentials, for task migration"
                  >
                    <ShieldAlert size={13} /> Exact
                  </button>
                </div>
                {selectedSession.public && (
                  <button
                    className="mt-2 inline-flex items-center gap-2 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
                    onClick={() => copyPublicLink(selectedSession.id)}
                    type="button"
                    title="Copy the public read-only link"
                  >
                    <Globe size={13} /> {copiedPublic ? 'Copied public link' : `Public · ${window.location.origin}/s/${selectedSession.id}`}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" onClick={onStartEditSession} type="button" title="Edit session title and topic">
                  <span className="inline-flex items-center gap-2"><Edit3 size={16} /> Edit</span>
                </button>
                <button className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700 hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300" onClick={() => onGenerateToken(selectedSession)} type="button" title="Create a default recording token for an agent">
                  <span className="inline-flex items-center gap-2"><KeyRound size={16} /> Token</span>
                </button>
                <button className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-700 hover:bg-violet-100 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300" onClick={() => onCreateImportToken(selectedSession)} type="button" title="Import: agent recalls all its past conversation history and uploads to PCP, then records follow-ups">
                  <span className="inline-flex items-center gap-2"><KeyRound size={16} /> Import</span>
                </button>
                <button className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300" onClick={() => onCreateExportToken(selectedSession)} type="button" title="Export: agent reads all PCP history first, then records new context, chat history, and media URLs">
                  <span className="inline-flex items-center gap-2"><KeyRound size={16} /> Export</span>
                </button>
                <button className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" onClick={() => onManageTokens(selectedSession)} type="button" title="Manage issued tokens: rename, delete">
                  <span className="inline-flex items-center gap-2"><ListChecks size={16} /> Tokens</span>
                </button>
                <button
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                  onClick={() => onTogglePublic(selectedSession, !selectedSession.public)}
                  type="button"
                  title={selectedSession.public ? 'Make this session private again' : 'Make this session publicly readable at /s/<id>'}
                >
                  <span className="inline-flex items-center gap-2">
                    {selectedSession.public ? <><Lock size={16} /> Make private</> : <><Globe size={16} /> Make public</>}
                  </span>
                </button>
                {selectedSession.archived ? (
                  <button className="rounded-md border border-emerald-200 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/60 dark:text-emerald-200 dark:hover:bg-emerald-950/40" onClick={onRestoreSelectedSession} type="button" title="Restore this session from trash">
                    <span className="inline-flex items-center gap-2"><RotateCcw size={16} /> Restore</span>
                  </button>
                ) : (
                  <button className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-200 dark:hover:bg-red-950/40" onClick={onArchiveSelectedSession} type="button" title="Move this session to trash">
                    <span className="inline-flex items-center gap-2"><Archive size={16} /> Remove</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Select or create a session to view messages.
            </div>
          )}
        </header>

        {editingSession && selectedSession && (
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Session title</span>
                <input
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-950"
                  value={editTitle}
                  onChange={(event) => onEditTitleChange(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Topic</span>
                <select
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-950"
                  value={editTopicId}
                  onChange={(event) => onEditTopicIdChange(event.target.value)}
                >
                  <option value="">Uncategorized (no topic)</option>
                  {topics.map((topic) => (
                    <option key={topic.id} value={topic.id}>{topic.title}</option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <button className="rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300" onClick={onSaveSessionEdits} type="button">
                  Save
                </button>
                <button className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-white dark:border-slate-700 dark:hover:bg-slate-800" onClick={onCancelSessionEdits} type="button">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {generatedToken && (
          <TokenDisplay content={generatedToken} onClose={onClearGeneratedToken} />
        )}

        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-h-0 flex-col px-5 pt-5">
            {selectedSession && (
              <div className="min-h-0 flex-1 overflow-y-auto pb-3">
                <MessageList sessionId={selectedSession.id} messages={messages} onChanged={handleChanged} hasCompactions={compactionCount > 0} />
                <CompactionList key={`${selectedSession.id}:${refreshKey}`} sessionId={selectedSession.id} onLoaded={setCompactionCount} />
              </div>
            )}
            {selectedSession && <ImportPanel sessionId={selectedSession.id} onImported={handleChanged} />}
          </div>

          {/* Collapsible events panel */}
          <div className="relative border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/70 xl:border-l xl:border-t-0">
            <button
              className="absolute -left-5 top-1/2 z-10 -translate-y-1/2 rounded-full border border-slate-200 bg-white p-1 shadow-sm hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
              onClick={onToggleEvents}
              type="button"
              title={eventsOpen ? 'Hide events' : 'Show events'}
            >
              {eventsOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
            {eventsOpen && (
              <aside className="px-5 py-5">
                <div className="mb-4 flex items-center gap-2">
                  <Settings2 size={18} className="text-slate-500 dark:text-slate-400" />
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Events</h3>
                </div>
                <div className="space-y-3">
                  {events.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">No events yet.</p>
                  ) : events.map((event) => (
                    <div key={event.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-950">
                      <p className="font-medium text-slate-800 dark:text-slate-100">{event.action}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{event.actor} - {formatDate(event.created_at || event.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </aside>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}