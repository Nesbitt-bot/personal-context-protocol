'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clipboard, Database, KeyRound } from 'lucide-react';
import { SiteNav } from '@/components/site-nav';
import { readJsonResponse } from '@/lib/http';
import { diagnosticMessage, errorCause } from '@/lib/logging';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [errorDocsUrl, setErrorDocsUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [initialized, setInitialized] = useState(true);
  const [setupMessage, setSetupMessage] = useState('');
  const [generatedToken, setGeneratedToken] = useState('');
  const nextPath = searchParams.get('next') || '/dashboard';

  useEffect(() => {
    checkSetupStatus();
  }, []);

  async function checkSetupStatus() {
    try {
      const response = await fetch('/api/v1/setup/status');
      const data = await readJsonResponse(response, {
        consequence: 'Unable to check setup status',
        moduleProcess: 'app setup / login setup probe',
        fallbackCause: 'setup status endpoint did not return JSON',
      });
      setInitialized(Boolean(data.initialized));
      if (data.error) {
        setError(data.error);
        setErrorDocsUrl(data.docs_url || '');
      }
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to check setup status',
        moduleProcess: 'app setup / login setup probe',
        cause: `browser could not reach /api/v1/setup/status or parse its response; ${errorCause(err)}`,
      }));
      setErrorDocsUrl('');
    } finally {
      setCheckingSetup(false);
    }
  }

  async function initializeDatabase() {
    setLoading(true);
    setError('');
    setErrorDocsUrl('');
    try {
      const response = await fetch('/api/v1/setup/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await readJsonResponse(response, {
        consequence: 'Unable to initialize database',
        moduleProcess: 'app setup / login initialization request',
        fallbackCause: 'setup init endpoint did not return JSON',
      });

      if (!response.ok || data.error) {
        setError(data.error || 'Unable to initialize database: app setup / login initialization request - setup was not accepted');
        setErrorDocsUrl(data.docs_url || '');
        return;
      }

      setInitialized(true);
      setSetupMessage(data.message || 'Database initialized.');
      if (data.ui_token) {
        localStorage.setItem('ui_token', data.ui_token);
        setGeneratedToken(data.ui_token);
      }
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to initialize database',
        moduleProcess: 'app setup / login initialization request',
        cause: `browser could not reach /api/v1/setup/init or parse its response; ${errorCause(err)}`,
      }));
      setErrorDocsUrl('');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Validates the admin token with the API before saving it locally and opening
   * the dashboard. This keeps the login button from bypassing authentication.
   */
  async function submitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = token.trim();
    if (!candidate) {
      setError('Unable to log in: user authentication / admin token form - admin token is required');
      setErrorDocsUrl('');
      return;
    }

    setLoading(true);
    setError('');
    setErrorDocsUrl('');
    try {
      const response = await fetch('/api/v1/auth/check', {
        headers: { Authorization: `Bearer ${candidate}` },
      });
      const data = await readJsonResponse(response, {
        consequence: 'Unable to log in',
        moduleProcess: 'user authentication / admin token check request',
        fallbackCause: 'auth check endpoint did not return JSON',
      });

      if (!response.ok || data.error) {
        setError(data.error || 'Unable to log in: user authentication / admin token check request - token was not accepted');
        setErrorDocsUrl(data.docs_url || '');
        return;
      }

      localStorage.setItem('ui_token', candidate);
      router.push(nextPath.startsWith('/') ? nextPath : '/dashboard');
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to log in',
        moduleProcess: 'user authentication / admin token check request',
        cause: `browser could not reach /api/v1/auth/check or parse its response; ${errorCause(err)}`,
      }));
      setErrorDocsUrl('');
    } finally {
      setLoading(false);
    }
  }

  if (checkingSetup) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-soft dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        Checking setup status...
      </div>
    );
  }

  if (!initialized) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-md bg-slate-950 p-3 text-white dark:bg-sky-400 dark:text-slate-950">
            <Database size={22} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Setup required</p>
            <h1 className="text-xl font-semibold text-slate-950 dark:text-white">Initialize database</h1>
          </div>
        </div>

        <p className="mb-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
          The admin token has not been created yet. Initialize the database to create the first-login credential.
        </p>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            <p>{error}</p>
            {errorDocsUrl && (
              <a className="mt-2 inline-flex font-medium underline" href={errorDocsUrl} rel="noreferrer" target="_blank">
                Open deployment guide
              </a>
            )}
          </div>
        )}

        <button
          className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
          disabled={loading}
          onClick={initializeDatabase}
          type="button"
        >
          {loading ? 'Initializing...' : 'Initialize database'} <ArrowRight size={16} />
        </button>
      </div>
    );
  }

  if (generatedToken) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-md bg-slate-950 p-3 text-white dark:bg-sky-400 dark:text-slate-950">
            <Check size={22} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Setup complete</p>
            <h1 className="text-xl font-semibold text-slate-950 dark:text-white">Save this admin token</h1>
          </div>
        </div>
        <p className="mb-4 text-sm leading-6 text-slate-600 dark:text-slate-300">{setupMessage}</p>
        <pre className="mb-4 max-h-36 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">{generatedToken}</pre>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            onClick={() => navigator.clipboard.writeText(generatedToken)}
            type="button"
          >
            <Clipboard size={16} /> Copy token
          </button>
          <Link className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300" href="/settings">
            Change it now <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form className="rounded-md border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900" onSubmit={submitToken}>
      <div className="mb-5 flex items-center gap-3">
        <div className="rounded-md bg-slate-950 p-3 text-white dark:bg-sky-400 dark:text-slate-950">
          <KeyRound size={22} />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Admin login</p>
          <h1 className="text-xl font-semibold text-slate-950 dark:text-white">Enter UI token</h1>
        </div>
      </div>

      <p className="mb-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
        Use the one-time setup token generated during database initialization. The browser stores it locally after validation.
      </p>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          <p>{error}</p>
          {errorDocsUrl && (
            <a className="mt-2 inline-flex font-medium underline" href={errorDocsUrl} rel="noreferrer" target="_blank">
              Open deployment guide
            </a>
          )}
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Admin token</span>
        <input
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-950"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Paste UI token"
          type="password"
        />
      </label>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
          disabled={loading}
          type="submit"
        >
          {loading ? 'Checking...' : 'Continue'} <ArrowRight size={16} />
        </button>
        <Link className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" href="/">
          <ArrowLeft size={16} /> Back
        </Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <SiteNav />
      <section className="mx-auto flex max-w-xl px-4 py-12 sm:px-6">
        <Suspense fallback={<div className="text-sm text-slate-500 dark:text-slate-400">Loading login...</div>}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
