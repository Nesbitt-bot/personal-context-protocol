'use client';

import { useState } from 'react';
import { Check, Clipboard } from 'lucide-react';
import { Modal } from '@/components/modal';

interface TokenDisplayProps {
  content: string;
  onClose: () => void;
}

/** Modal overlay showing the generated token + instruction block for copying. */
export function TokenDisplay({ content, onClose }: TokenDisplayProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied (insecure context / permissions); leave
      // the button in its default state so the user knows to copy manually.
      setCopied(false);
    }
  }

  const copyButton = (
    <button
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
        copied
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
          : 'border-amber-200 bg-white text-amber-900 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-slate-950 dark:text-amber-200'
      }`}
      onClick={copy}
      type="button"
      data-autofocus
    >
      {copied ? <><Check size={15} /> Copied</> : <><Clipboard size={15} /> Copy</>}
    </button>
  );

  return (
    <Modal
      title="Copy this token block now. It will not be shown again."
      onClose={onClose}
      actions={copyButton}
      widthClass="max-w-2xl"
      panelClass="border-amber-200 dark:border-amber-900/60"
      headerClass="border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40"
    >
      <pre className="whitespace-pre-wrap break-words bg-white p-4 text-xs text-slate-800 dark:bg-slate-950 dark:text-slate-200">{content}</pre>
    </Modal>
  );
}
