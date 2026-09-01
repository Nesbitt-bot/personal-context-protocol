'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Folder, Globe, Inbox, KeyRound, Loader2, MessageSquare, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { readJsonResponse } from '@/lib/http';
import { diagnosticMessage, errorCause } from '@/lib/logging';

type Scope = 'global' | 'folder' | 'session';

interface FolderNode { id: string; title: string; }
interface SessionNode { id: string; title: string; topic_id: string | null; }

interface ScopedTokenRecord {
  id: string;
  name: string;
  scope: Scope;
  folder_id: string | null;
  session_id: string | null;
  permissions: Record<string, boolean>;
  status: 'active' | 'expired' | 'revoked';
  created_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
}

const PERMISSION_LABELS: Array<[keyof ScopedTokenRecord['permissions'], string]> = [
  ['create_folders', 'Create folders'],
  ['delete_folders', 'Delete folders'],
  ['create_sessions', 'Create sessions'],
  ['delete_sessions', 'Delete sessions'],
  ['mint_tokens', 'Mint tokens'],
  ['rename_sessions', 'Rename sessions'],
  ['read_all', 'Read all'],
];

const EXPIRATIONS = ['1h', '24h', '7d', '30d', 'never'] as const;

function defaultPermissions(scope: Scope): Record<string, boolean> {
  const base: Record<string, boolean> = {};
  for (const [key] of PERMISSION_LABELS) base[key] = false;
  if (scope === 'global') {
    for (const key of Object.keys(base)) base[key] = true;
  } else if (scope === 'folder') {
    base.create_sessions = true;
    base.delete_sessions = true;
    base.mint_tokens = true;
    base.rename_sessions = true;
    base.read_all = true;
  }
  return base;
}

function getUiToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('ui_token') || '';
}

const STATUS_TONE: Record<ScopedTokenRecord['status'], string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  expired: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  revoked: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
};

function scopeLabel(t: ScopedTokenRecord) {
  if (t.scope === 'global') return 'Global (full)';
  if (t.scope === 'folder') return `Folder · ${t.folder_id}`;
  return `Session · ${t.session_id}`;
}

export function ScopedTokenManager({ onClose }: { onClose: () => void }) {
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [sessions, setSessions] = useState<SessionNode[]>([]);
  const [tokens, setTokens] = useState<ScopedTokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // create form state
  const [name, setName] = useState('');
  const [scope, setScope] = useState<Scope>('global');
  const [folderId, setFolderId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [perms, setPerms] = useState<Record<string, boolean>>(defaultPermissions('global'));
  const [expiresIn, setExpiresIn] = useState<string>('7d');
  const [generated, setGenerated] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${getUiToken()}` };
  }

  async function load() {
    setLoading(true);
    try {
      const [topicsRes, sessionsRes, tokensRes] = await Promise.all([
        fetch('/api/v1/topics', { headers: authHeaders() }),
        fetch('/api/v1/sessions', { headers: authHeaders() }),
        fetch('/api/v1/tokens', { headers: authHeaders() }),
      ]);
      const topicsData = await readJsonResponse(topicsRes, { consequence: 'Unable to load folders', moduleProcess: 'scoped token manager / folder list', fallbackCause: 'topics endpoint did not return JSON' });
      const sessionsData = await readJsonResponse(sessionsRes, { consequence: 'Unable to load sessions', moduleProcess: 'scoped token manager / session list', fallbackCause: 'sessions endpoint did not return JSON' });
      const tokensData = await readJsonResponse(tokensRes, { consequence: 'Unable to load tokens', moduleProcess: 'scoped token manager / token list', fallbackCause: 'tokens endpoint did not return JSON' });
      if (!topicsRes.ok || topicsData.error) { setError(topicsData.error || 'Unable to load folders'); return; }
      if (!sessionsRes.ok || sessionsData.error) { setError(sessionsData.error || 'Unable to load sessions'); return; }
      if (!tokensRes.ok || tokensData.error) { setError(tokensData.error || 'Unable to load tokens'); return; }
      setFolders((topicsData.topics || []).filter((t: FolderNode & { archived?: boolean }) => !t.archived));
      setSessions(sessionsData.sessions || []);
      setTokens(tokensData.tokens || []);
      setError('');
    } catch (err) {
      setError(diagnosticMessage({ consequence: 'Unable to load token manager', moduleProcess: 'scoped token manager / initial load', cause: `browser could not reach the token manager endpoints; ${errorCause(err)}` }));
    } finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const activeSessions = useMemo(() => sessions.filter((s) => (s as unknown as { archived?: boolean }).archived !== true), [sessions]);
  const byFolder = useMemo(() => {
    const map = new Map<string, SessionNode[]>();
    for (const s of activeSessions) {
      const key = s.topic_id ?? '__none__';
      map.set(key, [...(map.get(key) || []), s]);
    }
    return map;
  }, [activeSessions]);
  const uncategorized = byFolder.get('__none__') || [];

  function selectScope(next: Scope) {
    setScope(next);
    setPerms(defaultPermissions(next));
    setFolderId('');
    setSessionId('');
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function createToken() {
    setBusy(true);
    setError('');
    setGenerated('');
    try {
      const body: Record<string, unknown> = { name: name.trim() || `token-${Date.now()}`, scope, permissions: perms, expires_in: expiresIn };
      if (scope === 'folder') body.folder_id = folderId;
      if (scope === 'session') body.session_id = sessionId;
      const res = await fetch('/api/v1/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) });
      const data = await readJsonResponse(res, { consequence: 'Unable to create scoped token', moduleProcess: 'scoped token manager / create token', fallbackCause: 'create token endpoint did not return JSON' });
      if (!res.ok || data.error) { setError(data.error || 'Unable to create scoped token'); return; }
      setGenerated(data.access_token || data.token || '');
      setName('');
      await load();
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to create scoped token', moduleProcess: 'scoped token manager / create token', cause: errorCause(err) })); }
    finally { setBusy(false); }
  }

  async function revokeToken(tokenId: string) {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/tokens', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ token_id: tokenId, revoke: true }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setError(data.error || 'Unable to revoke token'); return; }
      await load();
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to revoke token', moduleProcess: 'scoped token manager / revoke', cause: errorCause(err) })); }
    finally { setBusy(false); }
  }

  async function deleteToken(tokenId: string) {
    if (!window.confirm('Permanently delete this token?')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/tokens', { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ token_id: tokenId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setError(data.error || 'Unable to delete token'); return; }
      await load();
    } catch (err) { setError(diagnosticMessage({ consequence: 'Unable to delete token', moduleProcess: 'scoped token manager / delete', cause: errorCause(err) })); }
    finally { setBusy(false); }
  }

  function sessionRow(s: SessionNode) {
    const active = scope === 'session' && sessionId === s.id;
    return (
      <button
        key={s.id}
        type="button"
        onClick={() => { selectScope('session'); setSessionId(s.id); }}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${active ? 'bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200' : 'text-slate-700 dark:text-slate-300'}`}
      >
        <MessageSquare size={14} className="shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate">{s.title}</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2"><KeyRound size={18} className="text-sky-600 dark:text-sky-300" /><h2 className="text-sm font-semibold text-slate-950 dark:text-white">Token manager</h2></div>
          <button className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose} type="button" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">{error}</div>}

          {generated && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/40">
              <p className="mb-1 text-sm font-medium text-amber-900 dark:text-amber-200">Token created — copy now, it will not be shown again:</p>
              <code className="block break-all rounded bg-white p-2 text-xs text-slate-800 dark:bg-slate-950 dark:text-slate-200">{generated}</code>
            </div>
          )}

          <section className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100"><Plus size={15} /> New scoped token</h3>
            <input
              className="mb-2 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-950 outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name (e.g. dsh-sync)"
            />

            {/* scope tree */}
            <div className="mb-2 max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-slate-200 p-1.5 dark:border-slate-800">
              <button type="button" onClick={() => selectScope('global')} className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${scope === 'global' ? 'bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200' : 'text-slate-700 dark:text-slate-300'}`}>
                <Globe size={14} className="shrink-0 opacity-70" /> Global (full access)
              </button>

              {uncategorized.length > 0 && (
                <div>
                  <button type="button" onClick={() => toggle('__none__')} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                    <ChevronRight size={14} className={`shrink-0 transition-transform ${expanded.has('__none__') ? 'rotate-90' : ''}`} />
                    <Inbox size={14} className="shrink-0 opacity-70" /> Uncategorized
                  </button>
                  {expanded.has('__none__') && <div className="ml-3 border-l border-slate-200 pl-2 dark:border-slate-800">{uncategorized.map(sessionRow)}</div>}
                </div>
              )}

              {folders.map((f) => {
                const folderActive = scope === 'folder' && folderId === f.id;
                const isOpen = expanded.has(f.id);
                return (
                  <div key={f.id}>
                    <div className="flex items-center gap-0.5">
                      <button type="button" onClick={() => toggle(f.id)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Expand">
                        <ChevronRight size={14} className={`shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      </button>
                      <button type="button" onClick={() => { selectScope('folder'); setFolderId(f.id); }} className={`flex flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${folderActive ? 'bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200' : 'text-slate-700 dark:text-slate-200'}`}>
                        <Folder size={14} className="shrink-0 opacity-70" /> {f.title}
                      </button>
                    </div>
                    {isOpen && <div className="ml-4 border-l border-slate-200 pl-2 dark:border-slate-800">{(byFolder.get(f.id) || []).map(sessionRow)}</div>}
                  </div>
                );
              })}
            </div>

            {/* permission checkboxes */}
            <div className="mb-2 grid grid-cols-2 gap-1.5">
              {PERMISSION_LABELS.map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-sky-600"
                    checked={Boolean(perms[key])}
                    onChange={(e) => setPerms((prev) => ({ ...prev, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <select className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)}>
                {EXPIRATIONS.map((x) => <option key={x} value={x}>{x === 'never' ? 'Never expires' : `Expires ${x}`}</option>)}
              </select>
              <button type="button" className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300" onClick={createToken} disabled={busy || (scope === 'folder' && !folderId) || (scope === 'session' && !sessionId)}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create token
              </button>
            </div>
          </section>

          <section className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100"><ShieldCheck size={15} /> Issued scoped tokens</h3>
            {loading ? <p className="text-sm text-slate-500">Loading…</p> : tokens.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No scoped tokens yet.</p> : (
              <div className="space-y-1.5">
                {tokens.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        {t.name} <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[t.status]}`}>{t.status}</span>
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{scopeLabel(t)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {t.status === 'active' && <button type="button" className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40" onClick={() => revokeToken(t.id)} disabled={busy}>Revoke</button>}
                      <button type="button" className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" onClick={() => deleteToken(t.id)} disabled={busy} title="Delete permanently"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
