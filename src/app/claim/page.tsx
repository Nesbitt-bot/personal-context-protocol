'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { ArrowRight, Link2 } from 'lucide-react';
import { SiteNav } from '@/components/site-nav';
import { readJsonResponse } from '@/lib/http';
import { diagnosticMessage, errorCause } from '@/lib/logging';
import { fetchSignedInUser, SignedInUser, uiAuthHeaders } from '@/lib/client-auth';

// The code is kept in sessionStorage (not in the login `next` URL) while the
// user signs in, so it never reaches server-side login state.
const PENDING_KEY = 'pcp_pending_claim';

function ClaimForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ session_id: string; principal: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fromUrl = searchParams.get('code') || '';
    const pending = sessionStorage.getItem(PENDING_KEY) || '';
    const initial = fromUrl || pending;
    if (fromUrl) {
      // Drop the code from the address bar and history.
      window.history.replaceState(null, '', '/claim');
    }
    fetchSignedInUser().then((current) => {
      if (!current) {
        if (initial) sessionStorage.setItem(PENDING_KEY, initial);
        router.replace('/login?next=/claim');
        return;
      }
      sessionStorage.removeItem(PENDING_KEY);
      setCode(initial);
      setUser(current);
    });
  }, [router, searchParams]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/v1/claims/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...uiAuthHeaders() },
        body: JSON.stringify({ code }),
      });
      const data = await readJsonResponse(response, {
        consequence: 'Unable to redeem claim code',
        moduleProcess: 'identity claims / claim redemption request',
        fallbackCause: 'claim endpoint did not return JSON',
      });
      if (!response.ok || data.error) {
        setError(data.error || 'Unable to redeem claim code: identity claims / claim redemption request - code was not accepted');
        return;
      }
      setResult({ session_id: data.session_id, principal: data.principal });
      setCode('');
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to redeem claim code',
        moduleProcess: 'identity claims / claim redemption request',
        cause: `browser could not reach /api/v1/claims/redeem; ${errorCause(err)}`,
      }));
    } finally {
      setLoading(false);
    }
  }

  if (!user) {
    return <div className="text-sm text-slate-500 dark:text-slate-400">Checking sign-in...</div>;
  }

  return (
    <form className="w-full rounded-md border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900" onSubmit={submit}>
      <div className="mb-5 flex items-center gap-3">
        <div className="rounded-md bg-slate-950 p-3 text-white dark:bg-sky-400 dark:text-slate-950">
          <Link2 size={22} />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Link an identity</p>
          <h1 className="text-xl font-semibold text-slate-950 dark:text-white">Claim a chat session</h1>
        </div>
      </div>
      <p className="mb-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
        Signed in as <strong>{user.display_name}</strong>. Redeeming a claim code links that chat identity to this account and gives
        you its session; later sessions from the same identity become yours automatically. Only redeem codes you received in your own
        private chat. Codes work once and expire after 15 minutes.
      </p>
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">{error}</div>
      )}
      {result && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          Linked <code>{result.principal}</code>.{' '}
          <Link className="font-medium underline" href={`/dashboard?session=${encodeURIComponent(result.session_id)}`}>Open the session</Link>
        </div>
      )}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Claim code</span>
        <input
          autoComplete="off"
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-950"
          onChange={(event) => setCode(event.target.value)}
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
          value={code}
        />
      </label>
      <button
        className="mt-5 inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
        disabled={loading || !code.trim()}
        type="submit"
      >
        {loading ? 'Linking...' : 'Link to my account'} <ArrowRight size={16} />
      </button>
    </form>
  );
}

export default function ClaimPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <SiteNav />
      <section className="mx-auto flex max-w-xl px-4 py-12 sm:px-6">
        <Suspense fallback={<div className="text-sm text-slate-500 dark:text-slate-400">Loading...</div>}>
          <ClaimForm />
        </Suspense>
      </section>
    </main>
  );
}
