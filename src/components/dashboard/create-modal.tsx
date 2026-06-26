'use client';

import { useEffect, useState } from 'react';
import { Folder, MessageSquare, X } from 'lucide-react';
import { Topic } from './types';

export interface TopicCreateValues {
  title: string;
  description: string;
}

export interface SessionCreateValues {
  title: string;
  topic_id: string | null;
  mode: 'wild' | 'exact';
}

interface CreateModalProps {
  kind: 'topic' | 'session';
  /** Default title to prefill (already de-duplicated against existing names). */
  defaultTitle: string;
  /** Topics for the session topic dropdown (active only). */
  topics?: Topic[];
  /** Prefilled topic for a new session (null = Uncategorized). */
  defaultTopicId?: string | null;
  onCancel: () => void;
  onCreateTopic?: (values: TopicCreateValues) => void;
  onCreateSession?: (values: SessionCreateValues) => void;
}

/**
 * Create dialog for a topic or session. Values are prefilled with sensible
 * defaults so the user can review and click Create without changing anything,
 * or edit the title / topic / mode first.
 */
export function CreateModal({ kind, defaultTitle, topics = [], defaultTopicId = null, onCancel, onCreateTopic, onCreateSession }: CreateModalProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState('');
  const [topicId, setTopicId] = useState<string>(defaultTopicId ?? '');
  const [mode, setMode] = useState<'wild' | 'exact'>('wild');

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function submit() {
    const trimmed = title.trim() || defaultTitle;
    if (kind === 'topic') {
      onCreateTopic?.({ title: trimmed, description: description.trim() });
    } else {
      onCreateSession?.({ title: trimmed, topic_id: topicId || null, mode });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            {kind === 'topic' ? <Folder size={18} className="text-sky-600 dark:text-sky-300" /> : <MessageSquare size={18} className="text-sky-600 dark:text-sky-300" />}
            <h2 className="text-sm font-semibold text-slate-950 dark:text-white">{kind === 'topic' ? 'New topic' : 'New session'}</h2>
          </div>
          <button className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onCancel} type="button" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Title</span>
            <input
              autoFocus
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-950"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && submit()}
              placeholder={defaultTitle}
            />
          </label>

          {kind === 'topic' && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Description (optional)</span>
              <textarea
                className="h-20 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-950"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          )}

          {kind === 'session' && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Topic</span>
                <select
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  value={topicId}
                  onChange={(event) => setTopicId(event.target.value)}
                >
                  <option value="">Uncategorized (no topic)</option>
                  {topics.map((topic) => (
                    <option key={topic.id} value={topic.id}>{topic.title}</option>
                  ))}
                </select>
              </label>
              <div>
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Recording mode</span>
                <div className="inline-flex items-center gap-1 rounded-md border border-slate-200 p-0.5 text-xs dark:border-slate-700">
                  <button className={`rounded px-3 py-1.5 ${mode === 'wild' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`} onClick={() => setMode('wild')} type="button" title="Agent may redact secrets it judges unsafe">Wild</button>
                  <button className={`rounded px-3 py-1.5 ${mode === 'exact' ? 'bg-amber-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`} onClick={() => setMode('exact')} type="button" title="Agent records verbatim, including credentials">Exact</button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button className="rounded-md border border-slate-200 px-4 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" onClick={onCancel} type="button">Cancel</button>
          <button className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300" onClick={submit} type="button">Create</button>
        </div>
      </div>
    </div>
  );
}
