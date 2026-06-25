'use client';

import { useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2, Pencil, Trash2, Undo2, X } from 'lucide-react';
import { diagnosticMessage, errorCause } from '@/lib/logging';

interface TokenRecord {
  id: string;
  name: string;
  status: 'active' | 'expired' | 'revoked';
  created_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
}

interface TokenModalProps {
  sessionId: string;
  sessionTitle: string;
  onClose: () => void;
}

const STATUS_TONE: Record<TokenRecord['status'], string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  expired: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  revoked: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
};

function formatDate(value?: string | null) {
  if (!value) return 'never';
  return new Date(value).toLocaleString();
}

/** Modal listing the session's issued tokens. Revoke now deletes from DB after a 3-second undo window. */
export function TokenModal({ sessionId, sessionTitle, onClose }: TokenModalProps) {
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  // { tokenId: secondsRemaining } — countdown before permanent delete
  const [undoState, setUndoState] = useState<Record<string, number>>({});
  const undoRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  useEffect(() => {
    load();
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Clear all undo timers on unmount
      Object.values(undoRef.current).forEach(clearInterval);
    };
  }, [sessionId]);

  function authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${localStorage.getItem('ui_token')}` };
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/tokens`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error || 'Unable to load tokens');
        return;
      }
      setTokens(data.tokens || []);
      setError('');
    } catch (err) {
      setError(diagnosticMessage({ consequence: 'Unable to load tokens', moduleProcess: 'session token administration / token list request', cause: `browser could not reach the token list endpoint; ${errorCause(err)}` }));
    } finally { setLoading(false); }
  }

  async function patchToken(tokenId: string, body: Record<string, unknown>, failVerb: string) {
    setBusyId(tokenId);
    setError('');
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/tokens`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ token_id: tokenId, ...body }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setError(data.error || `Unable to ${failVerb} token`); return; }
      await load();
    } catch (err) { setError(diagnosticMessage({ consequence: `Unable to ${failVerb} token`, moduleProcess: `session token administration / ${failVerb} request`, cause: `browser could not reach the token endpoint; ${errorCause(err)}` })); }
    finally { setBusyId(''); }
  }

  function rename(tokenId: string, currentName: string) {
    const name = window.prompt('Rename token', currentName);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) return;
    patchToken(tokenId, { name: trimmed }, 'rename');
  }

  /** Start a 3-second undo countdown, then permanently DELETE the token. */
  function startDelete(tokenId: string) {
    setUndoState(prev => ({ ...prev, [tokenId]: 3 }));
    const timer = setInterval(() => {
      setUndoState(prev => {
        const current = (prev[tokenId] || 0) - 1;
        if (current <= 0) {
          clearInterval(timer);
          delete undoRef.current[tokenId];
          // Execute permanent delete
          deleteToken(tokenId);
          return { ...prev };
        }
        return { ...prev, [tokenId]: current };
      });
    }, 1000);
    undoRef.current[tokenId] = timer;
  }

  function cancelDelete(tokenId: string) {
    const timer = undoRef.current[tokenId];
    if (timer) { clearInterval(timer); delete undoRef.current[tokenId]; }
    setUndoState(prev => { const next = { ...prev }; delete next[tokenId]; return next; });
  }

  async function deleteToken(tokenId: string) {
    setBusyId(tokenId);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/tokens`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ token_id: tokenId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setError(data.error || 'Unable to delete token permanently'); return; }
      await load();
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to delete token', moduleProcess: 'session token administration / delete request', cause: errorCause(err) })); }
    finally { setBusyId(''); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2"><KeyRound size={18} className="text-sky-600 dark:text-sky-300" /><h2 className="truncate text-sm font-semibold text-slate-950 dark:text-white">Tokens — {sessionTitle}</h2></div>
          <button className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose} type="button" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {error && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
          {loading ? <div className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading tokens...</div>
            : tokens.length === 0 ? <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No tokens issued for this session yet.</p>
            : <div className="space-y-2">
              {tokens.map((token) => {
                const seconds = undoState[token.id];
                return (
                  <div key={token.id} className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 dark:border-slate-800 ${seconds !== undefined ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30' : 'border-slate-200'}`}>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {token.name}
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[token.status]}`}>{token.status}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {token.expires_at ? `Expires ${formatDate(token.expires_at)}` : 'Never expires'} · Last used {formatDate(token.last_used_at)}
                      </p>
                    </div>
                    {seconds !== undefined ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums text-sm font-bold text-amber-700 dark:text-amber-300">{seconds}s</span>
                        <button className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-white px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-300" onClick={() => cancelDelete(token.id)} type="button">
                          <Undo2 size={14} /> Undo
                        </button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-2">
                        <button className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" onClick={() => rename(token.id, token.name)} disabled={busyId === token.id} type="button" title="Rename token" aria-label="Rename token"><Pencil size={14} /></button>
                        <button className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40" onClick={() => startDelete(token.id)} disabled={busyId === token.id} type="button" title="Delete token permanently"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          }
        </div>
      </div>
    </div>
  );
}
