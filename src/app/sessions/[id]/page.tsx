'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Clipboard, KeyRound, MessageSquare, Settings2 } from 'lucide-react';
import { diagnosticMessage, errorCause } from '@/lib/logging';

interface SessionRecord {
  id: string;
  title: string;
  topic_title: string | null;
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
  const [generatedToken, setGeneratedToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (sessionId) {
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

      const [sessionRes, messagesRes, eventsRes] = await Promise.all([
        fetch(`/api/v1/sessions/${sessionId}`, {
          headers: { Authorization: `Bearer ${uiToken}` },
        }),
        fetch(`/api/v1/sessions/${sessionId}/review`, {
          headers: { Authorization: `Bearer ${uiToken}` },
        }),
        fetch(`/api/v1/sessions/${sessionId}/events`, {
          headers: { Authorization: `Bearer ${uiToken}` },
        }),
      ]);

      const sessionData = await sessionRes.json();
      const messagesData = await messagesRes.json();
      const eventsData = await eventsRes.json();

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
    const name = window.prompt('Token name', `${session.title} AI token`);
    if (!name?.trim()) return;
    const canRename = window.confirm('Allow AI to suggest session titles?');

    try {
      const uiToken = getUiToken();
      const res = await fetch(`/api/v1/sessions/${sessionId}/tokens`, {
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
        `SESSION_ID: ${sessionId}`,
        `SESSION_TOKEN: ${data.token}`,
        '',
        `POST ${window.location.origin}/api/v1/sessions/${sessionId}/messages`,
        'Use Authorization: Bearer <SESSION_TOKEN>',
      ].join('\n');

      setGeneratedToken(instructions);
      await navigator.clipboard.writeText(instructions).catch(() => undefined);
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to create token',
        moduleProcess: 'session token administration / create token request',
        cause: `browser could not reach /api/v1/sessions/${sessionId}/tokens or parse its response; ${errorCause(err)}`,
      }));
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Loading session...
      </main>
    );
  }

  if (error) {
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
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{session.topic_title || 'Topic'}</p>
              <h1 className="truncate text-2xl font-semibold">{session.title}</h1>
              <p className="mt-1 text-sm text-slate-500">Created {formatDate(session.createdAt)}</p>
            </div>
            <button
              className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:-translate-y-0.5 hover:bg-slate-800"
              onClick={generateToken}
            >
              <KeyRound size={16} /> Generate token
            </button>
          </div>
        </header>

        {generatedToken && (
          <section className="mb-5 rounded-md border border-amber-200 bg-amber-50 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-amber-900">Copy this token block now.</p>
              <button
                className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-white px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100"
                onClick={() => navigator.clipboard.writeText(generatedToken)}
              >
                <Clipboard size={15} /> Copy
              </button>
            </div>
            <pre className="max-h-44 overflow-auto rounded-md bg-white p-3 text-xs text-slate-800">{generatedToken}</pre>
          </section>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquare size={18} className="text-sky-600" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Messages</h2>
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
                    className={`rounded-md border px-4 py-3 ${
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
