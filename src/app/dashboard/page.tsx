'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SiteNav } from '@/components/site-nav';
import { NavSidebar } from '@/components/dashboard/nav-sidebar';
import { SessionWorkspace } from '@/components/dashboard/session-workspace';
import { TokenModal } from '@/components/dashboard/token-modal';
import { EventLog, Message, Session, Topic } from '@/components/dashboard/types';
import { readJsonResponse } from '@/lib/http';
import { diagnosticMessage, errorCause } from '@/lib/logging';
import { buildAgentInstruction } from '@/lib/agent-protocol';

function getUiToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('ui_token');
}

/**
 * Dashboard coordinates API calls and renders a ChatGPT-style nav (collapsible
 * topic groups with nested sessions, plus an Uncategorized group) alongside the
 * session workspace.
 */
export default function Dashboard() {
  const router = useRouter();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<EventLog[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
  const [uiTokenSource, setUiTokenSource] = useState<string | null>(null);
  const [tokenModalSession, setTokenModalSession] = useState<Session | null>(null);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || null;
  const selectedTopic = topics.find((topic) => topic.id === selectedSession?.topic_id) || null;

  useEffect(() => {
    setHasUiToken(Boolean(getUiToken()));
    loadAll();
    loadAuthState();
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      loadSessionDetail(selectedSessionId);
    } else {
      setMessages([]);
      setEvents([]);
    }
  }, [selectedSessionId]);

  /** Reads the admin credential provenance to warn when a deploy token is in use. */
  async function loadAuthState() {
    const uiToken = getUiToken();
    if (!uiToken) return;
    try {
      const res = await fetch('/api/v1/auth/check', { headers: { Authorization: `Bearer ${uiToken}` } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.ui_token_source === 'string') setUiTokenSource(data.ui_token_source);
    } catch {
      // Non-fatal: the warning banner is advisory only.
    }
  }

  function saveUiToken() {
    const token = uiTokenInput.trim();
    if (!token) return;
    localStorage.setItem('ui_token', token);
    setHasUiToken(true);
    setUiTokenInput('');
    setError('');
    loadAll();
    loadAuthState();
  }

  function toggleExpand(groupId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${getUiToken()}` };
  }

  /** Loads topics and every session in one pass, then groups them in the nav. */
  async function loadAll() {
    setLoading(true);
    try {
      const uiToken = getUiToken();
      if (!uiToken) {
        setHasUiToken(false);
        router.replace('/login?next=/dashboard');
        return;
      }

      const [topicsRes, sessionsRes] = await Promise.all([
        fetch('/api/v1/topics', { headers: authHeaders() }),
        fetch('/api/v1/sessions', { headers: authHeaders() }),
      ]);
      const topicsData = await readJsonResponse(topicsRes, {
        consequence: 'Unable to load topics',
        moduleProcess: 'topic administration / list topics request',
        fallbackCause: 'topics endpoint did not return JSON',
      });
      const sessionsData = await readJsonResponse(sessionsRes, {
        consequence: 'Unable to load sessions',
        moduleProcess: 'session administration / list sessions request',
        fallbackCause: 'sessions endpoint did not return JSON',
      });

      if (!topicsRes.ok || topicsData.error) {
        setError(topicsData.error || 'Unable to load topics: topic administration / list topics request - API response did not include topics');
        return;
      }
      if (!sessionsRes.ok || sessionsData.error) {
        setError(sessionsData.error || 'Unable to load sessions: session administration / list sessions request - API response did not include sessions');
        return;
      }

      setTopics(topicsData.topics || []);
      setSessions(sessionsData.sessions || []);
      setError('');
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to load workspace',
        moduleProcess: 'dashboard / initial data load',
        cause: `browser could not reach the topics or sessions endpoint or parse its response; ${errorCause(err)}`,
      }));
    } finally {
      setLoading(false);
    }
  }

  async function loadSessionDetail(sessionId: string) {
    try {
      const [reviewRes, eventsRes] = await Promise.all([
        fetch(`/api/v1/sessions/${sessionId}/review`, { headers: authHeaders() }),
        fetch(`/api/v1/sessions/${sessionId}/events`, { headers: authHeaders() }),
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
    try {
      const res = await fetch('/api/v1/topics', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: '{}' });
      const data = await readJsonResponse(res, {
        consequence: 'Unable to create topic',
        moduleProcess: 'topic administration / create topic request',
        fallbackCause: 'create topic endpoint did not return JSON',
      });
      if (!res.ok || data.error) {
        setError(data.error || 'Unable to create topic: topic administration / create topic request - API response did not include success');
        return;
      }
      setExpanded((prev) => new Set(prev).add(data.id));
      setStatus(`Topic created: ${data.title}`);
      await loadAll();
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to create topic',
        moduleProcess: 'topic administration / create topic request',
        cause: `browser could not reach /api/v1/topics or parse its response; ${errorCause(err)}`,
      }));
    }
  }

  async function createSession(topicId: string | null) {
    try {
      const res = await fetch('/api/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(topicId ? { topic_id: topicId } : {}),
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
      setExpanded((prev) => new Set(prev).add(topicId ?? '__none__'));
      setSelectedSessionId(data.id);
      setStatus(`Session created: ${data.title}`);
      await loadAll();
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to create session',
        moduleProcess: 'session administration / create session request',
        cause: `browser could not reach /api/v1/sessions or parse its response; ${errorCause(err)}`,
      }));
    }
  }

  async function renameTopic(topicId: string) {
    const topic = topics.find((item) => item.id === topicId);
    const title = window.prompt('Rename topic', topic?.title || '');
    if (title === null) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`/api/v1/topics/${topicId}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error || 'Unable to rename topic: topic administration / rename topic request - API response did not include success');
        return;
      }
      await loadAll();
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to rename topic',
        moduleProcess: 'topic administration / rename topic request',
        cause: `browser could not reach the rename endpoint or parse its response; ${errorCause(err)}`,
      }));
    }
  }

  async function removeTopic(topicId: string) {
    if (!window.confirm('Remove this topic? Its sessions move to Uncategorized.')) return;
    try {
      // Move the topic's active sessions to Uncategorized so none are lost.
      const orphaned = sessions.filter((session) => session.topic_id === topicId && !session.archived);
      await Promise.all(
        orphaned.map((session) =>
          fetch(`/api/v1/sessions/${session.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ topic_id: null }),
          }),
        ),
      );
      const res = await fetch(`/api/v1/topics/${topicId}/archive`, { method: 'POST', headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error || 'Unable to remove topic: topic administration / archive topic request - API response did not indicate success');
        return;
      }
      setStatus('Topic removed. Its sessions moved to Uncategorized.');
      await loadAll();
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to remove topic',
        moduleProcess: 'topic administration / remove topic request',
        cause: `browser could not reach the archive endpoint or parse its response; ${errorCause(err)}`,
      }));
    }
  }

  async function updateSession(sessionId: string, fields: { title?: string; topic_id?: string | null; archived?: boolean; public?: boolean }) {
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(fields),
      });
      const data = await readJsonResponse(res, {
        consequence: 'Unable to update session',
        moduleProcess: 'session administration / update session request',
        fallbackCause: 'update session endpoint did not return JSON',
      });
      if (!res.ok || data.error) {
        setError(data.error || 'Unable to update session: session administration / update session request - API response did not include success');
        return false;
      }
      await loadAll();
      return true;
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to update session',
        moduleProcess: 'session administration / update session request',
        cause: `browser could not reach /api/v1/sessions/${sessionId} or parse its response; ${errorCause(err)}`,
      }));
      return false;
    }
  }

  async function removeSession(sessionId: string) {
    if (!window.confirm('Remove this session? It is archived and can be restored from Show archived.')) return;
    const ok = await updateSession(sessionId, { archived: true });
    if (ok && selectedSessionId === sessionId) setSelectedSessionId('');
    if (ok) setStatus('Session removed.');
  }

  function startEditSession() {
    if (!selectedSession) return;
    setEditTitle(selectedSession.title);
    setEditTopicId(selectedSession.topic_id || '');
    setEditingSession(true);
  }

  async function saveSessionEdits() {
    const title = editTitle.trim();
    if (!selectedSession || !title) return;
    const ok = await updateSession(selectedSession.id, { title, topic_id: editTopicId || null });
    if (ok) {
      setEditingSession(false);
      setStatus('Session updated');
    }
  }

  async function archiveSelectedSession() {
    if (!selectedSession) return;
    if (await updateSession(selectedSession.id, { archived: true })) {
      setStatus('Session archived');
    }
  }

  async function togglePublic(session: Session, next: boolean) {
    if (await updateSession(session.id, { public: next })) {
      setStatus(next ? 'Session is now public (read-only link).' : 'Session is now private.');
    }
  }

  async function restoreSelectedSession() {
    if (!selectedSession) return;
    if (await updateSession(selectedSession.id, { archived: false })) {
      setStatus('Session restored');
    }
  }

  async function generateToken(session: Session) {
    try {
      const res = await fetch(`/api/v1/sessions/${session.id}/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
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
      // Build from the page origin so the recording URL matches where the UI is open.
      const url = `${window.location.origin}/r/${session.id}`;
      const instruction = buildAgentInstruction(url, data.access_token);
      setGeneratedToken(instruction);
      setStatus('Recording URL + access token created. Copy them now; the token will not be shown again.');
      await navigator.clipboard.writeText(instruction).catch(() => undefined);
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
      {uiTokenSource === 'deploy' && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="mx-auto flex max-w-7xl items-start gap-2">
            <span>
              You are signed in with a <strong>deploy-generated</strong> admin token. A fresh token is generated on every deploy, so do not reuse an old deploy token. Set your own stable token in{' '}
              <Link href="/settings" className="font-medium underline">Settings</Link>, or define the{' '}
              <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">PCP_ADMIN_TOKEN</code> environment variable (32+ chars) and redeploy.
            </span>
          </div>
        </div>
      )}
      <div className="grid min-h-[calc(100vh-57px)] grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <NavSidebar
          topics={topics}
          sessions={sessions}
          loading={loading}
          selectedSessionId={selectedSessionId}
          expanded={expanded}
          query={query}
          showArchived={showArchived}
          onToggleExpand={toggleExpand}
          onQueryChange={setQuery}
          onShowArchivedChange={setShowArchived}
          onSelectSession={setSelectedSessionId}
          onCreateSession={createSession}
          onCreateTopic={createTopic}
          onRefresh={loadAll}
          onRenameTopic={renameTopic}
          onRemoveTopic={removeTopic}
          onRemoveSession={removeSession}
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
          onManageTokens={setTokenModalSession}
          onTogglePublic={togglePublic}
          onImported={() => selectedSession && loadSessionDetail(selectedSession.id)}
        />
      </div>
      {tokenModalSession && (
        <TokenModal
          sessionId={tokenModalSession.id}
          sessionTitle={tokenModalSession.title}
          onClose={() => setTokenModalSession(null)}
        />
      )}
    </main>
  );
}
