'use client';

import { MessageSquare, Plus, Search } from 'lucide-react';
import { formatDate } from './format';
import { Session, Topic } from './types';

interface SessionSidebarProps {
  selectedTopic: Topic | null;
  sessions: Session[];
  selectedSessionId: string;
  query: string;
  showArchived: boolean;
  newSessionTitle: string;
  onQueryChange: (query: string) => void;
  onShowArchivedChange: (showArchived: boolean) => void;
  onNewSessionTitleChange: (title: string) => void;
  onCreateSession: () => void;
  onSelectSession: (sessionId: string) => void;
}

/**
 * SessionSidebar filters and displays sessions for the selected topic. The
 * dashboard page supplies the already-filtered mutation callbacks.
 */
export function SessionSidebar({
  selectedTopic,
  sessions,
  selectedSessionId,
  query,
  showArchived,
  newSessionTitle,
  onQueryChange,
  onShowArchivedChange,
  onNewSessionTitleChange,
  onCreateSession,
  onSelectSession,
}: SessionSidebarProps) {
  return (
    <aside className="border-b border-slate-200 bg-slate-100/80 p-4 dark:border-slate-800 dark:bg-slate-900/70 lg:border-b-0 lg:border-r">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Sessions</p>
        <h2 className="truncate text-xl font-semibold text-slate-950 dark:text-white">{selectedTopic?.title || 'Select a topic'}</h2>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
        <Search size={16} className="text-slate-400" />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-950 outline-none placeholder:text-slate-400 dark:text-slate-100"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search sessions"
        />
      </div>

      <div className="mb-4 flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => onShowArchivedChange(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
          />
          Show archived
        </label>
      </div>

      <div className="mb-4 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-emerald-950"
          value={newSessionTitle}
          onChange={(event) => onNewSessionTitleChange(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && onCreateSession()}
          placeholder="New session"
          disabled={!selectedTopic}
        />
        <button
          className="rounded-md bg-emerald-600 p-2 text-white hover:-translate-y-0.5 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300"
          onClick={onCreateSession}
          disabled={!selectedTopic}
          title="Create session"
          type="button"
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="space-y-2">
        {sessions.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
            No sessions match this view.
          </div>
        ) : sessions.map((session) => (
          <button
            key={session.id}
            className={`w-full rounded-md border p-3 text-left shadow-sm hover:-translate-y-0.5 hover:shadow-soft ${
              selectedSessionId === session.id
                ? 'border-sky-400 bg-white ring-2 ring-sky-100 dark:bg-slate-950 dark:ring-sky-950'
                : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-700'
            } ${session.archived ? 'opacity-60' : ''}`}
            onClick={() => onSelectSession(session.id)}
            type="button"
          >
            <div className="mb-2 flex items-start gap-2">
              <MessageSquare size={17} className="mt-0.5 shrink-0 text-sky-600 dark:text-sky-300" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-950 dark:text-slate-100">{session.title}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(session.last_message_at || session.created_at)}</p>
          </button>
        ))}
      </div>
    </aside>
  );
}