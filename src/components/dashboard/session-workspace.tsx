'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Archive, Check, Clipboard, Edit3, Globe, KeyRound, ListChecks, Lock, MessageSquare, RotateCcw, Settings2 } from 'lucide-react';
import { formatDate } from './format';
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
  onManageTokens: (session: Session) => void;
  onTogglePublic: (session: Session, next: boolean) => void;
}

function messageTone(role: string) {
  if (role === 'assistant') return 'border-emerald-100 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/30';
  if (role === 'user') return 'border-sky-100 bg-sky-50/70 dark:border-sky-900/60 dark:bg-sky-950/30';
  return 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900';
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
  onManageTokens,
  onTogglePublic,
}: SessionWorkspaceProps) {
  const [copiedPublic, setCopiedPublic] = useState(false);

  function copyPublicLink(sessionId: string) {
    const url = `${window.location.origin}/s/${sessionId}`;
    navigator.clipboard.writeText(url).catch(() => undefined);
    setCopiedPublic(true);
    window.setTimeout(() => setCopiedPublic(false), 1500);
  }
  return (
    <section className="min-w-0 bg-white dark:bg-slate-950">
      <div className="flex min-h-screen flex-col">
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
                <button className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" onClick={onStartEditSession} type="button">
                  <span className="inline-flex items-center gap-2"><Edit3 size={16} /> Edit</span>
                </button>
                <button className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" onClick={() => onGenerateToken(selectedSession)} type="button">
                  <span className="inline-flex items-center gap-2"><KeyRound size={16} /> Token</span>
                </button>
                <button className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" onClick={() => onManageTokens(selectedSession)} type="button">
                  <span className="inline-flex items-center gap-2"><ListChecks size={16} /> Tokens</span>
                </button>
                <button
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                  onClick={() => onTogglePublic(selectedSession, !selectedSession.public)}
                  type="button"
                  title={selectedSession.public ? 'Make private' : 'Make public (read-only link)'}
                >
                  <span className="inline-flex items-center gap-2">
                    {selectedSession.public ? <><Lock size={16} /> Make private</> : <><Globe size={16} /> Make public</>}
                  </span>
                </button>
                {selectedSession.archived ? (
                  <button className="rounded-md border border-emerald-200 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/60 dark:text-emerald-200 dark:hover:bg-emerald-950/40" onClick={onRestoreSelectedSession} type="button">
                    <span className="inline-flex items-center gap-2"><RotateCcw size={16} /> Restore</span>
                  </button>
                ) : (
                  <button className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-200 dark:hover:bg-red-950/40" onClick={onArchiveSelectedSession} type="button">
                    <span className="inline-flex items-center gap-2"><Archive size={16} /> Remove</span>
                  </button>
                )}
                <Link className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" href={`/sessions/${selectedSession.id}`}>
                  Open page
                </Link>
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
          <div className="border-b border-slate-200 bg-amber-50 px-5 py-4 dark:border-slate-800 dark:bg-amber-950/40">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Copy this token block now.</p>
              <button
                className="rounded-md border border-amber-200 bg-white px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-slate-950 dark:text-amber-200 dark:hover:bg-amber-950/60"
                onClick={() => navigator.clipboard.writeText(generatedToken)}
                type="button"
              >
                <span className="inline-flex items-center gap-2"><Clipboard size={15} /> Copy</span>
              </button>
            </div>
            <pre className="max-h-44 overflow-auto rounded-md bg-white p-3 text-xs text-slate-800 dark:bg-slate-950 dark:text-slate-200">{generatedToken}</pre>
          </div>
        )}

        <div className="grid flex-1 grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 px-5 py-5">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquare size={18} className="text-sky-600 dark:text-sky-300" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Messages</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{messages.length}</span>
            </div>

            {messages.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                No messages recorded yet.
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <article key={message.id} className={`max-w-3xl rounded-md border px-4 py-3 shadow-sm ${messageTone(message.role)}`}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold uppercase tracking-wide">{message.role}</span>
                      <span>#{message.ordinal}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-900 dark:text-slate-100">{message.content}</p>
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                      {(message.provider || 'unknown')}/{(message.base_model || message.BaseModel || 'unknown')} - {formatDate(message.observed_at || message.observedAt)}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <aside className="border-t border-slate-200 bg-slate-50 px-5 py-5 dark:border-slate-800 dark:bg-slate-900/70 xl:border-l xl:border-t-0">
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
        </div>
      </div>
    </section>
  );
}