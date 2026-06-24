'use client';

import { useState } from 'react';
import { Check, TerminalSquare, Upload } from 'lucide-react';
import { diagnosticMessage, errorCause } from '@/lib/logging';

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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ui_token')}` },
        body: JSON.stringify({ payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error ? `${data.error}${data.hint ? ` — ${data.hint}` : ''}` : 'Unable to import: session import / request - the server did not accept the paste.');
        return;
      }
      if (data.imported_as === 'compact') {
        setResult('Imported a compaction block.');
      } else if (data.imported === 0) {
        setResult(`Nothing new — ${data.skipped} message(s) were already recorded.`);
      } else {
        setResult(`Imported ${data.imported} message(s); skipped ${data.skipped} duplicate(s).`);
      }
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
    <section className="mt-5 rounded-md border border-slate-200 bg-slate-950 p-4 text-slate-100 shadow-sm dark:border-slate-800">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <TerminalSquare size={15} /> Paste fallback to record
      </div>
      <p className="mb-3 text-xs leading-5 text-slate-400">
        If an agent could not upload from its sandbox, paste its fallback block here — a <code className="text-slate-300">{'{ messages }'}</code> object, the agent&apos;s JSON, a <code className="text-slate-300">&lt;PCP_COMPACT&gt;</code> block, or a plain transcript. Already-recorded messages are skipped automatically.
      </p>
      <textarea
        className="h-36 w-full resize-y rounded-md border border-slate-700 bg-black/40 p-3 font-mono text-xs text-slate-100 outline-none focus:border-sky-500"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={'{\n  "messages": [\n    { "role": "user", "content": "..." },\n    { "role": "assistant", "content": "..." }\n  ]\n}'}
        spellCheck={false}
      />
      {error && <p className="mt-2 rounded-md bg-red-950/50 px-3 py-2 text-xs text-red-200">{error}</p>}
      {result && (
        <p className="mt-2 inline-flex items-center gap-2 rounded-md bg-emerald-950/50 px-3 py-2 text-xs text-emerald-200">
          <Check size={14} /> {result}
        </p>
      )}
      <div className="mt-3 flex justify-end">
        <button
          className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
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
