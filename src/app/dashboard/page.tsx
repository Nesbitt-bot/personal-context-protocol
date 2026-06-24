'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SiteNav } from '@/components/site-nav';
import { SessionSidebar } from '@/components/dashboard/session-sidebar';
import { SessionWorkspace } from '@/components/dashboard/session-workspace';
import { TopicSidebar } from '@/components/dashboard/topic-sidebar';
import { EventLog, Message, Session, Topic } from '@/components/dashboard/types';
import { readJsonResponse } from '@/lib/http';
import { diagnosticMessage, errorCause, logError } from '@/lib/logging';

function getUiToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('ui_token');
}

/**
 * Dashboard coordinates API calls and passes all rendering to focused topic,
 * session, and workspace components.
 */
export default function Dashboard() {
  const router = useRouter();
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

  /** Saves the one-time UI token in browser storage for admin API calls. */
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
        router.replace('/login?next=/dashboard');
        return;
      }

      const res = await fetch('/api/v1/topics', {
        headers: { Authorization: `Bearer ${uiToken}` },
      });
      const data = await readJsonResponse(res, {
        consequence: 'Unable to load topics',
        moduleProcess: 'topic administration / list topics request',
        fallbackCause: 'topics endpoint did not return JSON',
      });

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
      const data = await readJsonResponse(res, {
        consequence: 'Unable to load sessions',
        moduleProcess: 'session administration / list sessions request',
        fallbackCause: 'topic sessions endpoint did not return JSON',
      });

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

      const reviewData = await readJsonResponse(reviewRes, {
        consequence: 'Unable to load messages',
        moduleProcess: 'session review / message list request',
        fallbackCause: 'session review endpoint did not return JSON',
      });
      const eventsData = await readJsonResponse(eventsRes, {
        consequence: 'Unable to load events',
        moduleProcess: 'session review / event list request',
        fallbackCause: 'session events endpoint did not return JSON',
      });

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
    // Title is optional: clicking "New Topic" with an empty box lets the server
    // generate a unique default name.
    const title = newTopicTitle.trim();

    try {
      const uiToken = getUiToken();
      const res = await fetch('/api/v1/topics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${uiToken}`,
        },
        body: JSON.stringify(title ? { title } : {}),
      });
      const data = await readJsonResponse(res, {
        consequence: 'Unable to create topic',
        moduleProcess: 'topic administration / create topic request',
        fallbackCause: 'create topic endpoint did not return JSON',
      });

      if (!res.ok || data.error) {
        setError(data.error || 'Unable to create topic: topic administration / create topic request - API response did not include success');
        return;
      }

      setNewTopicTitle('');
      setSelectedTopicId(data.id);
      setStatus(`Topic created: ${data.title || title}`);
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
    // Title is optional: one-click "New Session" lets the server generate a
    // unique default name within the topic.
    const title = newSessionTitle.trim();
    if (!selectedTopic) return;

    try {
      const uiToken = getUiToken();
      const res = await fetch(`/api/v1/topics/${selectedTopic.id}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${uiToken}`,
        },
        body: JSON.stringify(title ? { title } : {}),
      });
      const data = await readJsonResponse(res, {
        consequence: 'Unable to create session',
        moduleProcess: 'session administration / create session request',
        fallbackCause: 'create session endpoint did not return JSON',
      });

      if (!res.ok || data.error) {
        setError(data.error || 'Unable to create session: session administration / create session request - API response did not include success');
        return;
      }

      setNewSessionTitle('');
      setSelectedSessionId(data.id);
      setStatus(`Session created: ${data.title || title}`);
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
      const data = await readJsonResponse(res, {
        consequence: 'Unable to update session',
        moduleProcess: 'session administration / update session request',
        fallbackCause: 'update session endpoint did not return JSON',
      });

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
    // Quick generate with the default 7-day expiry. Full expiration controls and
    // the token status list live on the session detail page (/sessions/<id>).
    try {
      const uiToken = getUiToken();
      const res = await fetch(`/api/v1/sessions/${session.id}/tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${uiToken}`,
        },
        body: JSON.stringify({ expires_in: '7d' }),
      });
      const data = await readJsonResponse(res, {
        consequence: 'Unable to create token',
        moduleProcess: 'session token administration / create token request',
        fallbackCause: 'create token endpoint did not return JSON',
      });

      if (!res.ok || data.error || !data.access_token) {
        setError(data.error || 'Unable to create token: session token administration / create token request - API response did not include access token');
        return;
      }

      setGeneratedToken(data.instruction);
      setStatus('Recording URL + access token created. Copy them now; the token will not be shown again.');
      await navigator.clipboard.writeText(data.instruction).catch(() => undefined);
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to create token',
        moduleProcess: 'session token administration / create token request',
        cause: `browser could not reach /api/v1/sessions/${session.id}/tokens or parse its response; ${errorCause(err)}`,
      }));
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <SiteNav />
      <div className="grid min-h-[calc(100vh-57px)] grid-cols-1 lg:grid-cols-[280px_360px_minmax(0,1fr)]">
        <TopicSidebar
          topics={topics}
          loading={loading}
          selectedTopicId={selectedTopicId}
          newTopicTitle={newTopicTitle}
          onNewTopicTitleChange={setNewTopicTitle}
          onCreateTopic={createTopic}
          onRefreshTopics={loadTopics}
          onSelectTopic={(topicId) => {
            setSelectedTopicId(topicId);
            setSelectedSessionId('');
          }}
        />
        <SessionSidebar
          selectedTopic={selectedTopic}
          sessions={visibleSessions}
          selectedSessionId={selectedSessionId}
          query={query}
          showArchived={showArchived}
          newSessionTitle={newSessionTitle}
          onQueryChange={setQuery}
          onShowArchivedChange={setShowArchived}
          onNewSessionTitleChange={setNewSessionTitle}
          onCreateSession={createSession}
          onSelectSession={setSelectedSessionId}
        />
        <SessionWorkspace
          error={error}
          status={status}
          hasUiToken={hasUiToken}
          uiTokenInput={uiTokenInput}
          selectedTopic={selectedTopic}
          selectedSession={selectedSession}
          topics={topics}
          messages={messages}
          events={events}
          editingSession={editingSession}
          editTitle={editTitle}
          editTopicId={editTopicId}
          generatedToken={generatedToken}
          onUiTokenInputChange={setUiTokenInput}
          onSaveUiToken={saveUiToken}
          onStartEditSession={startEditSession}
          onEditTitleChange={setEditTitle}
          onEditTopicIdChange={setEditTopicId}
          onSaveSessionEdits={saveSessionEdits}
          onCancelSessionEdits={() => setEditingSession(false)}
          onArchiveSelectedSession={archiveSelectedSession}
          onRestoreSelectedSession={restoreSelectedSession}
          onGenerateToken={generateToken}
        />
      </div>
    </main>
  );
}