'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Check, Clipboard, Database, KeyRound } from 'lucide-react';
import { diagnosticMessage, errorCause } from '@/lib/logging';

export default function SetupPage() {
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uiToken, setUiToken] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    try {
      const res = await fetch('/api/v1/setup/status');
      const data = await res.json();
      setInitialized(data.initialized);
      if (data.error) {
        setError(data.error);
      }
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to check setup status',
        moduleProcess: 'app setup / status request',
        cause: `browser could not read /api/v1/setup/status; ${errorCause(err)}`,
      }));
    } finally {
      setLoading(false);
    }
  }

  async function handleInit() {
    try {
      const res = await fetch('/api/v1/setup/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (data.ui_token) {
        localStorage.setItem('ui_token', data.ui_token);
        setUiToken(data.ui_token);
        setInitialized(true);
        setError('');
      } else {
        setError(data.error || diagnosticMessage({
          consequence: 'Unable to initialize database',
          moduleProcess: 'app setup / initialize database request',
          cause: 'API response did not include a UI token or structured error',
        }));
      }
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to initialize database',
        moduleProcess: 'app setup / initialize database request',
        cause: `browser could not reach /api/v1/setup/init or parse its response; ${errorCause(err)}`,
      }));
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-950">
      <section className="w-full max-w-2xl rounded-md border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-md bg-slate-950 p-3 text-white">
            <Database size={24} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Personal Context Protocol</p>
            <h1 className="text-2xl font-semibold">Setup</h1>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Checking setup status...
          </div>
        ) : initialized && !uiToken ? (
          <div className="space-y-5">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
              <div className="flex items-center gap-2 font-medium">
                <Check size={18} />
                App initialized
              </div>
              <p className="mt-2 text-sm">Open the dashboard. If the UI token is not saved in this browser, paste it there.</p>
            </div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:-translate-y-0.5 hover:bg-slate-800"
            >
              Open dashboard <ArrowRight size={16} />
            </Link>
          </div>
        ) : initialized ? (
          <div className="space-y-5">
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <div className="flex items-center gap-2 font-medium">
                <KeyRound size={18} />
                Save this UI token now
              </div>
              <p className="mt-2 text-sm">The token is shown once and has been saved in this browser for the dashboard.</p>
            </div>

            <pre className="max-h-40 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">{uiToken}</pre>

            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-100"
                onClick={() => navigator.clipboard.writeText(uiToken)}
              >
                <Clipboard size={16} /> Copy token
              </button>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:-translate-y-0.5 hover:bg-slate-800"
              >
                Open dashboard <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-sm leading-6 text-slate-600">
              Initialize the database and generate the UI token used by the admin dashboard.
            </p>
            <button
              onClick={handleInit}
              className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:-translate-y-0.5 hover:bg-slate-800"
            >
              Initialize database <ArrowRight size={16} />
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
