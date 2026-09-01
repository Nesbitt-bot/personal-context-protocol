'use client';

import { useEffect, useState } from 'react';
import { Link2, Loader2, Plus, X } from 'lucide-react';
import { readJsonResponse } from '@/lib/http';
import { diagnosticMessage, errorCause } from '@/lib/logging';

interface LinkRecord {
  id: string;
  other_session_id: string;
  other_title: string | null;
  label: string | null;
  created_at: string | null;
}

function getUiToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('ui_token') || '';
}

/** Inline, self-contained linked-sessions panel for the session workspace. */
export function LinkedSessions({ sessionId }: { sessionId: string }) {
  const [links, setLinks] = useState<LinkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${getUiToken()}` };
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/links`, { headers: authHeaders() });
      const data = await readJsonResponse(res, { consequence: 'Unable to load links', moduleProcess: 'session link administration / link list request', fallbackCause: 'links endpoint did not return JSON' });
      if (!res.ok || data.error) { setError(data.error || 'Unable to load links'); return; }
      setLinks(data.links || []);
      setError('');
    } catch (err) {
      setError(diagnosticMessage({ consequence: 'Unable to load links', moduleProcess: 'session link administration / link list request', cause: errorCause(err) }));
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [sessionId]);

  async function createLink() {
    const target = window.prompt('Link to session id:');
    if (target === null) return;
    const toId = target.trim();
    if (!toId) return;
    const labelInput = window.prompt('Label (optional, e.g. "records", "continuation"):');
    const label = labelInput && labelInput.trim() ? labelInput.trim() : undefined;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/links`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ to_session_id: toId, label }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setError(data.error || 'Unable to link session'); return; }
      await load();
    } catch (err) {
      setError(diagnosticMessage({ consequence: 'Unable to link session', moduleProcess: 'session link administration / create link request', cause: errorCause(err) }));
    } finally { setBusy(false); }
  }

  async function removeLink(linkId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/links`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ link_id: linkId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setError(data.error || 'Unable to remove link'); return; }
      await load();
    } catch (err) {
      setError(diagnosticMessage({ consequence: 'Unable to remove link', moduleProcess: 'session link administration / delete link request', cause: errorCause(err) }));
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><Link2 size={15} /> Linked sessions</h3>
        <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" onClick={createLink} disabled={busy}>
          <Plus size={13} /> Link
        </button>
      </div>
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-300">{error}</p>}
      {loading ? (
        <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><Loader2 size={13} className="animate-spin" /> Loading…</p>
      ) : links.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">No linked sessions.</p>
      ) : (
        <ul className="space-y-1.5">
          {links.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm dark:border-slate-800">
              <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">
                <a className="font-medium text-sky-700 hover:underline dark:text-sky-300" href={`/dashboard?session=${encodeURIComponent(link.other_session_id)}`}>
                  {link.other_title || link.other_session_id}
                </a>
                {link.label && <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{link.label}</span>}
              </span>
              <button type="button" className="rounded-md p-1 text-slate-400 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-300" onClick={() => removeLink(link.id)} disabled={busy} title="Remove link" aria-label="Remove link">
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
