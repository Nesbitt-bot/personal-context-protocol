'use client';

import { useState } from 'react';
import { Check, Clipboard } from 'lucide-react';

/** A command snippet with a copy button. */
export function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="relative">
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-slate-200 bg-slate-50 p-3 pr-12 text-xs leading-5 text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">{text}</pre>
      <button
        className="absolute right-2 top-2 rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        onClick={copy}
        type="button"
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
      >
        {copied ? <Check size={14} /> : <Clipboard size={14} />}
      </button>
    </div>
  );
}
