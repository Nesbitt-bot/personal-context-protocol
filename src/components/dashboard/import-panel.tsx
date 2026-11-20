'use client';

import { useState } from 'react';
import { Check, Upload } from 'lucide-react';
import { diagnosticMessage, errorCause } from '@/lib/logging';
import { uiAuthHeaders } from '@/lib/client-auth';

interface ImportPanelProps {
  sessionId: string;
  onImported: () => void;
}

/**
 * Human fallback import. When an agent cannot upload from its sandbox, the human
 * pastes the agent's fallback block (a { messages } object, an agent wrapper
 * JSON, a <PCP_COMPACT> block, or a plain transcript) here. The server records
 * it and skips anything already present, so re-pasting merges cleanly.
 */
export function ImportPanel({ sessionId, onImported }: ImportPanelProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  async function submit() {
    const payload = text.trim();
    if (!payload) return;
    setBusy(true);
    setError('');
    setResult('');
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...uiAuthHeaders() },
        body: JSON.stringify({ payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error ? `${data.error}${data.hint ? ` — ${data.hint}` : ''}` : 'Unable to import: session import / request - the server did not accept the paste.');
        return;
      }
      const imported = data.imported || { messages: 0, compactions: 0 };
      const parts: string[] = [];
      if (imported.messages) parts.push(`${imported.messages} message(s)`);
      if (imported.compactions) parts.push(`${imported.compactions} compaction(s)`);
      if (data.skipped) parts.push(`skipped ${data.skipped} duplicate(s)`);
      setResult(data.notice || (parts.length ? `Imported ${parts.join('; ')}.` : 'Nothing new to import.'));
      setText('');
      onImported();
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to import',
        moduleProcess: 'session import / paste request',
        cause: `browser could not reach the import endpoint; ${errorCause(err)}`,
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-3 shrink-0 rounded-md border border-slate-200 bg-slate-50 p-4 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <p className="mb-3 text-xs leading-5 text-slate-600 dark:text-slate-400">
        If an agent could not upload from its sandbox, paste its fallback block here — a <code className="text-slate-800 dark:text-slate-300">{'{ messages }'}</code> object, the agent&apos;s JSON, a <code className="text-slate-800 dark:text-slate-300">&lt;PCP_COMPACT&gt;</code> block, or a plain transcript. Already-recorded messages are skipped automatically.
      </p>
      <textarea
        aria-label="Fallback transcript"
        className="h-36 w-full resize-y rounded-md border border-slate-300 bg-white p-3 font-mono text-xs text-slate-900 placeholder:text-slate-500 outline-none focus:border-sky-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:border-sky-400"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={'{\n  "messages": [\n    { "role": "user", "content": "..." },\n    { "role": "assistant", "content": "..." }\n  ]\n}'}
        spellCheck={false}
      />
      {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/50 dark:text-red-200">{error}</p>}
      {result && (
        <p className="mt-2 inline-flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          <Check size={14} /> {result}
        </p>
      )}
      <div className="mt-3 flex justify-end">
        <button
          className="inline-flex items-center gap-2 rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={submit}
          disabled={busy || !text.trim()}
          type="button"
        >
          <Upload size={15} /> {busy ? 'Importing...' : 'Import & merge'}
        </button>
      </div>
    </section>
  );
}
