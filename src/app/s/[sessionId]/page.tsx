'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Globe, MessageSquare } from 'lucide-react';
import { SiteNav } from '@/components/site-nav';
import { SiteFooter } from '@/components/site-footer';
import { diagnosticMessage, errorCause } from '@/lib/logging';

interface PublicMessage {
  id: string;
  ordinal: number;
  role: string;
  content: string;
  provider: string | null;
  base_model: string | null;
  observed_at: string | null;
}

interface PublicSession {
  id: string;
  title: string;
  topic_title: string | null;
  created_at: string | null;
  last_message_at: string | null;
}

function formatDate(value?: string | null) {
  if (!value) return 'No activity yet';
  return new Date(value).toLocaleString();
}

function tone(role: string) {
  if (role === 'assistant') return 'border-emerald-100 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/30';
  if (role === 'user') return 'border-sky-100 bg-sky-50/70 dark:border-sky-900/60 dark:bg-sky-950/30';
  return 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900';
}

/** Public read-only transcript for a session the admin marked public. */
export default function PublicSessionPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;
  const [session, setSession] = useState<PublicSession | null>(null);
  const [messages, setMessages] = useState<PublicMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      try {
        const res = await fetch(`/api/v1/public/sessions/${sessionId}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
          setError(data.error || 'Unable to view session: public session view / read request - this session is private or does not exist.');
          return;
        }
        setSession(data.session);
        setMessages(data.messages || []);
      } catch (err) {
        setError(diagnosticMessage({
          consequence: 'Unable to view session',
          moduleProcess: 'public session view / read request',
          cause: `browser could not reach the public session endpoint; ${errorCause(err)}`,
        }));
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <SiteNav />
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {loading ? (
          <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Loading session...</div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">{error}</div>
        ) : session ? (
          <>
            <header className="mb-6 animate-fade-in-up rounded-md border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <p className="mb-1 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                <Globe size={13} /> Public read-only · {session.topic_title || 'Uncategorized'}
              </p>
              <h1 className="truncate text-2xl font-semibold">{session.title}</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Created {formatDate(session.created_at)}</p>
            </header>

            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <MessageSquare size={18} className="text-sky-600 dark:text-sky-300" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Messages</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{messages.length}</span>
              </div>
              {messages.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No messages recorded yet.</div>
              ) : (
                messages.map((message) => (
                  <article key={message.id} className={`animate-fade-in rounded-md border px-4 py-3 shadow-sm ${tone(message.role)}`}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold uppercase tracking-wide">{message.role}</span>
                      <span>#{message.ordinal}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-900 dark:text-slate-100">{message.content}</p>
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                      {(message.provider || 'unknown')}/{(message.base_model || 'unknown')} - {formatDate(message.observed_at)}
                    </p>
                  </article>
                ))
              )}
            </section>
          </>
        ) : null}
      </div>
      <SiteFooter />
    </main>
  );
}
