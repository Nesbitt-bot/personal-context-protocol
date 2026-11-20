'use client';

import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { uiAuthHeaders } from '@/lib/client-auth';
import { MAX_DOCUMENT_BYTES } from '@/lib/session-document';

interface ImportExportPanelProps {
  sessionId: string;
  readOnly: boolean;
  onImported: () => void;
}

/** File transfer reads the full server document, never just the visible message page. */
export function ImportExportPanel({ sessionId, readOnly, onImported }: ImportExportPanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'import' | 'export' | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const url = `/api/v1/sessions/${encodeURIComponent(sessionId)}/document`;
  const button = 'inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800';

  async function failure(response: Response, action: string) {
    const body = await response.json().catch(() => ({}));
    return body.error || `Unable to ${action} JSON: session files / request - server returned HTTP ${response.status}`;
  }

  async function download() {
    setBusy('export'); setError(''); setStatus('');
    try {
      const response = await fetch(url, { headers: uiAuthHeaders(), cache: 'no-store' });
      if (!response.ok) { setError(await failure(response, 'export')); return; }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl; link.download = `pcp-session-${sessionId}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setStatus('Session JSON downloaded.');
    } catch {
      setError('Unable to export JSON: session files / download - browser could not retrieve the session document.');
    } finally { setBusy(null); }
  }

  async function upload(file?: File) {
    if (!file) return;
    setError(''); setStatus('');
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError('Unable to import JSON: session files / size check - file exceeds 20 MiB.'); return;
    }
    setBusy('import');
    try {
      const text = await file.text();
      try { JSON.parse(text); }
      catch { setError('Unable to import JSON: session files / file parsing - selected file is not valid JSON.'); return; }
      const response = await fetch(url, { method: 'POST', headers: { ...uiAuthHeaders(), 'Content-Type': 'application/json' }, body: text });
      if (!response.ok) { setError(await failure(response, 'import')); return; }
      const result = await response.json();
      setStatus(`Imported ${result.imported} messages; skipped ${result.skipped} already recorded messages.`);
      onImported();
    } catch {
      setError('Unable to import JSON: session files / upload - browser could not complete the request.');
    } finally { setBusy(null); }
  }

  return <div className="space-y-3 p-3">
    <p className="text-sm text-slate-600 dark:text-slate-300">Download this session as JSON, or upload a session JSON file to merge its messages here. An empty session also adopts the file&apos;s title and summary.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy !== null} onClick={download}><Download size={15} />{busy === 'export' ? 'Downloading…' : 'Download JSON'}</button>
      <button type="button" className={button} disabled={busy !== null || readOnly} onClick={() => input.current?.click()}><Upload size={15} />{busy === 'import' ? 'Uploading…' : 'Upload JSON'}</button>
      <input ref={input} type="file" accept=".json,application/json" aria-label="Session JSON file" className="hidden" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }} />
    </div>
    {readOnly && <p className="text-xs text-slate-500">Unlock or restore this session to upload a file.</p>}
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    {status && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{status}</p>}
  </div>;
}
