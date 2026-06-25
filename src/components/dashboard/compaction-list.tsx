'use client';

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { formatDate } from './format';
import { diagnosticMessage, errorCause } from '@/lib/logging';

interface Compaction {
  id: string;
  summary: string;
  timeline?: unknown;
  decisions?: unknown;
  requirements?: unknown;
  open_questions?: unknown;
  artifacts?: unknown;
  warnings?: unknown;
  provider?: string | null;
  base_model?: string | null;
  created_at?: string | null;
}

interface CompactionListProps {
  sessionId: string;
  onLoaded?: (count: number) => void;
}

// Order and labels mirror the compaction fields, rendered like a system prompt.
const FIELDS: Array<{ key: keyof Compaction; label: string }> = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'requirements', label: 'Requirements' },
  { key: 'open_questions', label: 'Open questions' },
  { key: 'artifacts', label: 'Artifacts' },
  { key: 'warnings', label: 'Warnings' },
];

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

function renderValue(value: unknown) {
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc space-y-1 pl-5">
        {value.map((item, index) => (
          <li key={index}>{typeof item === 'object' && item !== null ? <pre className="whitespace-pre-wrap break-words">{JSON.stringify(item, null, 2)}</pre> : String(item)}</li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object' && value !== null) {
    return <pre className="whitespace-pre-wrap break-words">{JSON.stringify(value, null, 2)}</pre>;
  }
  return <p className="whitespace-pre-wrap break-words">{String(value)}</p>;
}

/**
 * Renders durable compaction summaries as first-class, readable content — laid
 * out like a system prompt (labeled sections). Hidden when the session has none.
 */
export function CompactionList({ sessionId, onLoaded }: CompactionListProps) {
  const [compactions, setCompactions] = useState<Compaction[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/compactions`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('ui_token')}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        if (res.ok && !data.error) {
          setCompactions(data.compactions || []);
          onLoaded?.((data.compactions || []).length);
        } else {
          setError(data.error || 'Unable to load compactions: session review / compaction request - API did not return compactions');
        }
      } catch (err) {
        if (active) {
          setError(diagnosticMessage({
            consequence: 'Unable to load compactions',
            moduleProcess: 'session review / compaction request',
            cause: `browser could not reach the compaction endpoint; ${errorCause(err)}`,
          }));
        }
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, [sessionId]);

  if (error) {
    return <div className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">{error}</div>;
  }
  if (!loaded || compactions.length === 0) return null;

  return (
    <section className="mt-5">
      <div className="mb-3 flex items-center gap-2">
        <FileText size={18} className="text-violet-600 dark:text-violet-300" />
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Compactions</h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{compactions.length}</span>
      </div>

      <div className="space-y-4">
        {compactions.map((compaction) => (
          <article key={compaction.id} className="overflow-hidden rounded-md border border-violet-200 bg-violet-50/40 dark:border-violet-900/50 dark:bg-violet-950/20">
            <header className="flex items-center justify-between gap-2 border-b border-violet-200 bg-violet-100/60 px-4 py-2 text-xs text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200">
              <span className="font-semibold uppercase tracking-wide">Compact summary</span>
              <span>{(compaction.provider || 'unknown')}/{(compaction.base_model || 'unknown')} · {formatDate(compaction.created_at)}</span>
            </header>
            <div className="space-y-3 px-4 py-3 font-mono text-xs leading-5 text-slate-800 dark:text-slate-200">
              <div>
                <p className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">Summary</p>
                <p className="whitespace-pre-wrap break-words">{compaction.summary}</p>
              </div>
              {FIELDS.filter((field) => !isEmpty(compaction[field.key])).map((field) => (
                <div key={field.key as string}>
                  <p className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">{field.label}</p>
                  {renderValue(compaction[field.key])}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
