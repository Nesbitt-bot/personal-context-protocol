'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Check,
  Clipboard,
  Edit3,
  Folder,
  KeyRound,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
} from 'lucide-react';
import { diagnosticMessage, errorCause, logError } from '@/lib/logging';

interface Topic {
  id: string;
  title: string;
  description: string | null;
  archived: boolean;
  createdAt?: string;
  session_count: number;
}

interface Session {
  id: string;
  topic_id: string;
  title: string;
  archived: boolean;
  created_at: string;
  updated_at?: string;
  last_message_at: string | null;
}

interface Message {
  id: string;
  ordinal: number;
  role: string;
  content: string;
  provider: string | null;
  BaseModel?: string | null;
  base_model?: string | null;
  observedAt?: string;
  observed_at?: string;
}

interface EventLog {
  id: string;
  action: string;
  actor: string;
  createdAt?: string;
  created_at?: string;
  detailsJson?: Record<string, unknown>;
}

function getUiToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('ui_token');
}

function formatDate(value?: string | null) {
  if (!value) return 'No activity yet';
  return new Date(value).toLocaleString();
}

export default function Dashboard() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<EventLog[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [editingSession, setEditingSession] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editTopicId, setEditTopicId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [uiTokenInput, setUiTokenInput] = useState('');
  const [generatedToken, setGeneratedToken] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasUiToken, setHasUiToken] = useState(false);

  const selectedTopic = topics.find((topic) => topic.id === selectedTopicId) || null;
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || null;

  const visibleSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sessions.filter((session) => {
      if (!showArchived && session.archived) return false;
      if (!normalizedQuery) return true;
      return session.title.toLowerCase().includes(normalizedQuery);
    });
  }, [query, sessions, showArchived]);

  useEffect(() => {
    setHasUiToken(Boolean(getUiToken()));
    loadTopics();
  }, []);

  useEffect(() => {
    if (selectedTopicId) {
      loadSessions(selectedTopicId);
    }
  }, [selectedTopicId]);

  useEffect(() => {
    if (selectedSessionId) {
      loadSessionDetail(selectedSessionId);
    } else {
      setMessages([]);
      setEvents([]);
    }
  }, [selectedSessionId]);

  function saveUiToken() {
    const token = uiTokenInput.trim();
    if (!token) return;
    localStorage.setItem('ui_token', token);
    setHasUiToken(true);
    setUiTokenInput('');
    setError('');
    loadTopics();
  }

  async function loadTopics() {
    setLoading(true);
    try {
      const uiToken = getUiToken();
      if (!uiToken) {
        setHasUiToken(false);
        setError('Unable to load dashboard: user authentication / local UI token lookup - ui_token missing from browser storage. Paste the setup token.');
        return;
      }

      const res = await fetch('/api/v1/topics', {
        headers: { Authorization: `Bearer ${uiToken}` },
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || 'Unable to load topics: topic administration / list topics request - API response did not include topics');
        return;
      }

      const activeTopics = (data.topics || []).filter((topic: Topic) => !topic.archived);
      setTopics(activeTopics);

      if (!selectedTopicId && activeTopics[0]) {
        setSelectedTopicId(activeTopics[0].id);
      }
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to load topics',
        moduleProcess: 'topic administration / list topics request',
        cause: `browser could not reach /api/v1/topics or parse its response; ${errorCause(err)}`,
      }));
    } finally {
      setLoading(false);
    }
  }

  async function loadSessions(topicId: string) {
    try {
      const uiToken = getUiToken();
      const res = await fetch(`/api/v1/topics/${topicId}/sessions`, {
        headers: { Authorization: `Bearer ${uiToken}` },
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || 'Unable to load sessions: session administration / list sessions request - API response did not include sessions');
        return;
      }

      const nextSessions: Session[] = data.sessions || [];
      setSessions(nextSessions);

      if (!nextSessions.some((session) => session.id === selectedSessionId)) {
        const firstActive = nextSessions.find((session) => !session.archived) || nextSessions[0];
        setSelectedSessionId(firstActive?.id || '');
      }
    } catch (err) {
      logError({
        consequence: 'Unable to load sessions',
        moduleProcess: 'session administration / list sessions request',
        cause: `browser could not reach /api/v1/topics/${topicId}/sessions or parse its response`,
        error: err,
      });
    }
  }

  async function loadSessionDetail(sessionId: string) {
    try {
      const uiToken = getUiToken();
      const [reviewRes, eventsRes] = await Promise.all([
        fetch(`/api/v1/sessions/${sessionId}/review`, {
          headers: { Authorization: `Bearer ${uiToken}` },
        }),
        fetch(`/api/v1/sessions/${sessionId}/events`, {
          headers: { Authorization: `Bearer ${uiToken}` },
        }),
      ]);

      const reviewData = await reviewRes.json();
      const eventsData = await eventsRes.json();

      if (!reviewRes.ok || reviewData.error) {
        setError(reviewData.error || 'Unable to load messages: session review / message list request - API response did not include messages');
        return;
      }

      if (!eventsRes.ok || eventsData.error) {
        setError(eventsData.error || 'Unable to load events: session review / event list request - API response did not include events');
        return;
      }

      setMessages(reviewData.messages || []);
      setEvents(eventsData.events || []);
      setError('');
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to load session data',
        moduleProcess: 'session review / load selected session',
        cause: `browser could not reach session review endpoints or parse their responses; ${errorCause(err)}`,
      }));
    }
  }

  async function createTopic() {
    const title = newTopicTitle.trim();
    if (!title) return;

    try {
      const uiToken = getUiToken();
      const res = await fetch('/api/v1/topics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${uiToken}`,
        },
        body: JSON.stringify({ title }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || 'Unable to create topic: topic administration / create topic request - API response did not include success');
        return;
      }

      setNewTopicTitle('');
      setSelectedTopicId(data.id);
      setStatus(`Topic created: ${title}`);
      await loadTopics();
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to create topic',
        moduleProcess: 'topic administration / create topic request',
        cause: `browser could not reach /api/v1/topics or parse its response; ${errorCause(err)}`,
      }));
    }
  }

  async function createSession() {
    const title = newSessionTitle.trim();
    if (!selectedTopic || !title) return;

    try {
      const uiToken = getUiToken();
      const res = await fetch(`/api/v1/topics/${selectedTopic.id}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${uiToken}`,
        },
        body: JSON.stringify({ title }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || 'Unable to create session: session administration / create session request - API response did not include success');
        return;
      }

      setNewSessionTitle('');
      setSelectedSessionId(data.id);
      setStatus(`Session created: ${title}`);
      await loadSessions(selectedTopic.id);
      await loadTopics();
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to create session',
        moduleProcess: 'session administration / create session request',
        cause: `browser could not reach /api/v1/topics/${selectedTopic.id}/sessions or parse its response; ${errorCause(err)}`,
      }));
    }
  }

  function startEditSession() {
    if (!selectedSession) return;
    setEditTitle(selectedSession.title);
    setEditTopicId(selectedSession.topic_id);
    setEditingSession(true);
  }

  async function updateSession(fields: { title?: string; topic_id?: string; archived?: boolean }) {
    if (!selectedSession) return;

    try {
      const uiToken = getUiToken();
      const res = await fetch(`/api/v1/sessions/${selectedSession.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${uiToken}`,
        },
        body: JSON.stringify(fields),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || 'Unable to update session: session administration / update session request - API response did not include success');
        return;
      }

      setEditingSession(false);
      setStatus('Session updated');
      const nextTopicId = fields.topic_id || selectedTopicId;
      if (nextTopicId !== selectedTopicId) {
        setSelectedTopicId(nextTopicId);
      }
      await loadSessions(nextTopicId);
      await loadTopics();
      setSelectedSessionId(selectedSession.id);
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to update session',
        moduleProcess: 'session administration / update session request',
        cause: `browser could not reach /api/v1/sessions/${selectedSession.id} or parse its response; ${errorCause(err)}`,
      }));
    }
  }

  async function saveSessionEdits() {
    const title = editTitle.trim();
    if (!selectedSession || !title || !editTopicId) return;
    await updateSession({ title, topic_id: editTopicId });
  }

  async function archiveSelectedSession() {
    if (!selectedSession) return;
    await updateSession({ archived: true });
  }

  async function restoreSelectedSession() {
    if (!selectedSession) return;
    await updateSession({ archived: false });
  }

  async function generateToken(session: Session) {
    const name = window.prompt('Token name', `${session.title} AI token`);
    if (!name?.trim()) return;
    const canRename = window.confirm('Allow AI to suggest session titles?');

    try {
      const uiToken = getUiToken();
      const res = await fetch(`/api/v1/sessions/${session.id}/tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${uiToken}`,
        },
        body: JSON.stringify({ name: name.trim(), can_rename_session: canRename }),
      });
      const data = await res.json();

      if (!res.ok || data.error || !data.token) {
        setError(data.error || 'Unable to create token: session token administration / create token request - API response did not include token');
        return;
      }

      const instructions = [
        `APP_URL: ${window.location.origin}`,
        `SESSION_ID: ${session.id}`,
        `SESSION_TOKEN: ${data.token}`,
        '',
        `POST ${window.location.origin}/api/v1/sessions/${session.id}/messages`,
        'Use Authorization: Bearer <SESSION_TOKEN>',
      ].join('\n');

      setGeneratedToken(instructions);
      setStatus('Session token created. Copy it now; it will not be shown again.');
      await navigator.clipboard.writeText(instructions).catch(() => undefined);
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to create token',
        moduleProcess: 'session token administration / create token request',
        cause: `browser could not reach /api/v1/sessions/${session.id}/tokens or parse its response; ${errorCause(err)}`,
      }));
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[280px_360px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 bg-white/90 p-4 shadow-sm lg:border-b-0 lg:border-r">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">PCP</p>
              <h1 className="text-lg font-semibold">Topics</h1>
            </div>
            <button
              className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              onClick={loadTopics}
              title="Refresh topics"
            >
              <RefreshCw size={17} />
            </button>
          </div>

          <div className="mb-4 flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              value={newTopicTitle}
              onChange={(event) => setNewTopicTitle(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && createTopic()}
              placeholder="new-topic"
            />
            <button
              className="rounded-md bg-slate-950 p-2 text-white hover:-translate-y-0.5 hover:bg-slate-800"
              onClick={createTopic}
              title="Create topic"
            >
              <Plus size={18} />
            </button>
          </div>

          <div className="space-y-1">
            {loading ? (
              <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-500">Loading topics...</div>
            ) : topics.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 px-3 py-6 text-sm text-slate-500">
                Create a topic to start recording sessions.
              </div>
            ) : topics.map((topic) => (
              <button
                key={topic.id}
                className={`group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100 ${
                  selectedTopicId === topic.id ? 'bg-slate-950 text-white hover:bg-slate-900' : 'text-slate-700'
                }`}
                onClick={() => {
                  setSelectedTopicId(topic.id);
                  setSelectedSessionId('');
                }}
              >
                <Folder size={17} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{topic.title}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${
                  selectedTopicId === topic.id ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                  {topic.session_count}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <aside className="border-b border-slate-200 bg-slate-100/80 p-4 lg:border-b-0 lg:border-r">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sessions</p>
            <h2 className="truncate text-xl font-semibold">{selectedTopic?.title || 'Select a topic'}</h2>
          </div>

          <div className="mb-3 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
            <Search size={16} className="text-slate-400" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sessions"
            />
          </div>

          <div className="mb-4 flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Show archived
            </label>
          </div>

          <div className="mb-4 flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              value={newSessionTitle}
              onChange={(event) => setNewSessionTitle(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && createSession()}
              placeholder="New session"
              disabled={!selectedTopic}
            />
            <button
              className="rounded-md bg-emerald-600 p-2 text-white hover:-translate-y-0.5 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={createSession}
              disabled={!selectedTopic}
              title="Create session"
            >
              <Plus size={18} />
            </button>
          </div>

          <div className="space-y-2">
            {visibleSessions.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-6 text-sm text-slate-500">
                No sessions match this view.
              </div>
            ) : visibleSessions.map((session) => (
              <button
                key={session.id}
                className={`w-full rounded-md border p-3 text-left shadow-sm hover:-translate-y-0.5 hover:shadow-soft ${
                  selectedSessionId === session.id
                    ? 'border-sky-400 bg-white ring-2 ring-sky-100'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                } ${session.archived ? 'opacity-60' : ''}`}
                onClick={() => setSelectedSessionId(session.id)}
              >
                <div className="mb-2 flex items-start gap-2">
                  <MessageSquare size={17} className="mt-0.5 shrink-0 text-sky-600" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{session.title}</span>
                </div>
                <p className="text-xs text-slate-500">{formatDate(session.last_message_at || session.created_at)}</p>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 bg-white">
          <div className="flex min-h-screen flex-col">
            <header className="border-b border-slate-200 px-5 py-4">
              {error && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
              {status && (
                <div className="mb-3 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  <Check size={16} />
                  <span>{status}</span>
                </div>
              )}

              {!hasUiToken && (
                <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <label className="mb-2 block text-sm font-medium text-amber-900">UI token</label>
                  <div className="flex gap-2">
                    <input
                      className="min-w-0 flex-1 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-200"
                      value={uiTokenInput}
                      onChange={(event) => setUiTokenInput(event.target.value)}
                      placeholder="Paste setup token"
                    />
                    <button className="rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-800" onClick={saveUiToken}>
                      Save
                    </button>
                  </div>
                </div>
              )}

              {selectedSession ? (
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                      <span>{selectedTopic?.title}</span>
                      {selectedSession.archived && <span className="rounded-full bg-slate-100 px-2 py-0.5">Archived</span>}
                    </div>
                    <h2 className="truncate text-2xl font-semibold">{selectedSession.title}</h2>
                    <p className="text-sm text-slate-500">Last activity: {formatDate(selectedSession.last_message_at)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-100" onClick={startEditSession}>
                      <span className="inline-flex items-center gap-2"><Edit3 size={16} /> Edit</span>
                    </button>
                    <button className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-100" onClick={() => generateToken(selectedSession)}>
                      <span className="inline-flex items-center gap-2"><KeyRound size={16} /> Token</span>
                    </button>
                    {selectedSession.archived ? (
                      <button className="rounded-md border border-emerald-200 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50" onClick={restoreSelectedSession}>
                        <span className="inline-flex items-center gap-2"><RotateCcw size={16} /> Restore</span>
                      </button>
                    ) : (
                      <button className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50" onClick={archiveSelectedSession}>
                        <span className="inline-flex items-center gap-2"><Archive size={16} /> Remove</span>
                      </button>
                    )}
                    <Link className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-100" href={`/sessions/${selectedSession.id}`}>
                      Open page
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500">
                  Select or create a session to view messages.
                </div>
              )}
            </header>

            {editingSession && selectedSession && (
              <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-slate-700">Session title</span>
                    <input
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-slate-700">Topic</span>
                    <select
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                      value={editTopicId}
                      onChange={(event) => setEditTopicId(event.target.value)}
                    >
                      {topics.map((topic) => (
                        <option key={topic.id} value={topic.id}>{topic.title}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <button className="rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800" onClick={saveSessionEdits}>
                      Save
                    </button>
                    <button className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-white" onClick={() => setEditingSession(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {generatedToken && (
              <div className="border-b border-slate-200 bg-amber-50 px-5 py-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-amber-900">Copy this token block now.</p>
                  <button
                    className="rounded-md border border-amber-200 bg-white px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100"
                    onClick={() => navigator.clipboard.writeText(generatedToken)}
                  >
                    <span className="inline-flex items-center gap-2"><Clipboard size={15} /> Copy</span>
                  </button>
                </div>
                <pre className="max-h-44 overflow-auto rounded-md bg-white p-3 text-xs text-slate-800">{generatedToken}</pre>
              </div>
            )}

            <div className="grid flex-1 grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 px-5 py-5">
                <div className="mb-4 flex items-center gap-2">
                  <MessageSquare size={18} className="text-sky-600" />
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Messages</h3>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{messages.length}</span>
                </div>

                {messages.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
                    No messages recorded yet.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((message) => (
                      <article
                        key={message.id}
                        className={`max-w-3xl rounded-md border px-4 py-3 shadow-sm ${
                          message.role === 'assistant'
                            ? 'border-emerald-100 bg-emerald-50/60'
                            : message.role === 'user'
                              ? 'border-sky-100 bg-sky-50/70'
                              : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                          <span className="font-semibold uppercase tracking-wide">{message.role}</span>
                          <span>#{message.ordinal}</span>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-900">{message.content}</p>
                        <p className="mt-3 text-xs text-slate-500">
                          {(message.provider || 'unknown')}/{(message.base_model || message.BaseModel || 'unknown')} - {formatDate(message.observed_at || message.observedAt)}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <aside className="border-t border-slate-200 bg-slate-50 px-5 py-5 xl:border-l xl:border-t-0">
                <div className="mb-4 flex items-center gap-2">
                  <Settings2 size={18} className="text-slate-500" />
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Events</h3>
                </div>
                <div className="space-y-3">
                  {events.length === 0 ? (
                    <p className="text-sm text-slate-500">No events yet.</p>
                  ) : events.map((event) => (
                    <div key={event.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm shadow-sm">
                      <p className="font-medium text-slate-800">{event.action}</p>
                      <p className="text-xs text-slate-500">{event.actor} - {formatDate(event.created_at || event.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
