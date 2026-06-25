'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Clipboard, KeyRound, Link2, Settings2 } from 'lucide-react';
import { diagnosticMessage, errorCause } from '@/lib/logging';
import { buildAgentInstruction } from '@/lib/agent-protocol';
import { ImportPanel } from '@/components/dashboard/import-panel';
import { MessageList } from '@/components/dashboard/message-list';

interface SessionRecord {
  id: string;
  title: string;
  topic_title: string | null;
  mode?: 'wild' | 'exact';
  archived: boolean;
  createdAt: string;
  lastMessageAt: string | null;
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

interface TokenRecord {
  id: string;
  name: string;
  can_rename_session: boolean;
  status: 'active' | 'expired' | 'revoked';
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

const EXPIRATION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days (default)' },
  { value: '30d', label: '30 days' },
  { value: 'never', label: 'Never expire' },
];

const STATUS_TONE: Record<TokenRecord['status'], string> = {
  active: 'bg-emerald-100 text-emerald-700',
  expired: 'bg-amber-100 text-amber-700',
  revoked: 'bg-red-100 text-red-700',
};

function formatDate(value?: string | null) {
  if (!value) return 'No activity yet';
  return new Date(value).toLocaleString();
}

export default function SessionDetail() {
  const params = useParams();
  const sessionId = params.id as string;
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<EventLog[]>([]);
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [expiresIn, setExpiresIn] = useState('7d');
  const [canRename, setCanRename] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [instruction, setInstruction] = useState('');
  const [recordingUrl, setRecordingUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (sessionId) {
      setRecordingUrl(`${window.location.origin}/r/${sessionId}`);
      loadSession();
    }
  }, [sessionId]);

  function getUiToken() {
    return localStorage.getItem('ui_token');
  }

  async function loadSession() {
    try {
      const uiToken = getUiToken();
      if (!uiToken) {
        setError('Unable to load session data: user authentication / local UI token lookup - ui_token missing from browser storage. Return to setup first.');
        return;
      }

      const headers = { Authorization: `Bearer ${uiToken}` };
      const [sessionRes, messagesRes, eventsRes, tokensRes] = await Promise.all([
        fetch(`/api/v1/sessions/${sessionId}`, { headers }),
        fetch(`/api/v1/sessions/${sessionId}/review`, { headers }),
        fetch(`/api/v1/sessions/${sessionId}/events`, { headers }),
        fetch(`/api/v1/sessions/${sessionId}/tokens`, { headers }),
      ]);

      const sessionData = await sessionRes.json();
      const messagesData = await messagesRes.json();
      const eventsData = await eventsRes.json();
      const tokensData = await tokensRes.json();

      if (!sessionRes.ok || sessionData.error) {
        setError(sessionData.error || 'Unable to load session data: session review / session detail request - API response did not include session');
        return;
      }

      if (!messagesRes.ok || messagesData.error) {
        setError(messagesData.error || 'Unable to load session messages: session review / message list request - API response did not include messages');
        return;
      }

      if (!eventsRes.ok || eventsData.error) {
        setError(eventsData.error || 'Unable to load session events: session review / event list request - API response did not include events');
        return;
      }

      setSession(sessionData);
      setMessages(messagesData.messages || []);
      setEvents(eventsData.events || []);
      setTokens(tokensRes.ok && !tokensData.error ? tokensData.tokens || [] : []);
      setError('');
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to load session data',
        moduleProcess: 'session review / load session detail requests',
        cause: `browser could not reach a session detail endpoint or parse its response; ${errorCause(err)}`,
      }));
    } finally {
      setLoading(false);
    }
  }

  async function generateToken() {
    if (!session) return;

    try {
      const uiToken = getUiToken();
      const res = await fetch(`/api/v1/sessions/${sessionId}/tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${uiToken}`,
        },
        body: JSON.stringify({ expires_in: expiresIn, can_rename_session: canRename }),
      });

      const data = await res.json();
      if (!res.ok || data.error || !data.access_token) {
        setError(data.error || 'Unable to create token: session token administration / create token request - API response did not include access token');
        return;
      }

      // Build the recording URL from the actual page origin so it always matches
      // where the user opened the UI, regardless of how PCP_APP_URL is set.
      const url = `${window.location.origin}/r/${sessionId}`;
      const text = buildAgentInstruction(url, data.access_token, session?.mode || 'wild');
      setAccessToken(data.access_token);
      setInstruction(text);
      setRecordingUrl(url);
      await navigator.clipboard.writeText(text).catch(() => undefined);
      await loadSession();
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to create token',
        moduleProcess: 'session token administration / create token request',
        cause: `browser could not reach /api/v1/sessions/${sessionId}/tokens or parse its response; ${errorCause(err)}`,
      }));
    }
  }

  function copy(value: string) {
    navigator.clipboard.writeText(value).catch(() => undefined);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Loading session...
      </main>
    );
  }

  if (error && !session) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-3xl rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-3xl rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Unable to show session: session review / session lookup - session response was empty or session was not found.
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-5 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
          <Link href="/dashboard" className="mb-4 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-950">
            <ArrowLeft size={16} /> Back to dashboard
          </Link>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{session.topic_title || 'Topic'}</p>
            <h1 className="truncate text-2xl font-semibold">{session.title}</h1>
            <p className="mt-1 text-sm text-slate-500">Created {formatDate(session.createdAt)}</p>
          </div>
        </header>

        {error && (
          <div className="mb-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <section className="mb-5 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Link2 size={18} className="text-sky-600" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Agent recording pair</h2>
          </div>

          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Recording URL</label>
          <div className="mb-4 flex gap-2">
            <input readOnly value={recordingUrl} className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800" />
            <button className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-100" onClick={() => copy(recordingUrl)} type="button">
              <Clipboard size={15} /> Copy
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-[200px_auto_auto] md:items-end">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Token expiration</span>
              <select
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500"
                value={expiresIn}
                onChange={(event) => setExpiresIn(event.target.value)}
              >
                {EXPIRATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
              <input type="checkbox" checked={canRename} onChange={(event) => setCanRename(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Allow AI to suggest session title
            </label>
            <button
              className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              onClick={generateToken}
              type="button"
            >
              <KeyRound size={16} /> Generate access token
            </button>
          </div>

          {accessToken && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-amber-900">Copy the access token and instruction now. The token will not be shown again.</p>
                <button className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-white px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100" onClick={() => copy(instruction)} type="button">
                  <Clipboard size={15} /> Copy instruction
                </button>
              </div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-amber-800">Access token</label>
              <div className="mb-3 flex gap-2">
                <input readOnly value={accessToken} className="min-w-0 flex-1 rounded-md border border-amber-200 bg-white px-3 py-2 font-mono text-xs text-slate-800" />
                <button className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-amber-900 hover:bg-amber-100" onClick={() => copy(accessToken)} type="button">
                  <Clipboard size={15} /> Copy
                </button>
              </div>
              <pre className="max-h-56 overflow-auto rounded-md bg-white p-3 text-xs text-slate-800">{instruction}</pre>
            </div>
          )}

          {tokens.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Issued tokens</h3>
              <div className="space-y-2">
                {tokens.map((token) => (
                  <div key={token.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{token.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[token.status]}`}>{token.status}</span>
                    <span className="text-xs text-slate-500">
                      {token.expires_at ? `Expires ${formatDate(token.expires_at)}` : 'Never expires'} · Last used {token.last_used_at ? formatDate(token.last_used_at) : 'never'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <MessageList sessionId={sessionId} messages={messages} onChanged={loadSession} />
            <ImportPanel sessionId={sessionId} onImported={loadSession} />
          </section>

          <aside className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Settings2 size={18} className="text-slate-500" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Events</h2>
            </div>
            <div className="space-y-3">
              {events.length === 0 ? (
                <p className="text-sm text-slate-500">No events yet.</p>
              ) : events.map((event) => (
                <div key={event.id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-medium text-slate-800">{event.action}</p>
                  <p className="text-xs text-slate-500">{event.actor} - {formatDate(event.created_at || event.createdAt)}</p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
