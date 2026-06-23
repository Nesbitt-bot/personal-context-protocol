'use client';

import { Folder, Plus, RefreshCw } from 'lucide-react';
import { Topic } from './types';

interface TopicSidebarProps {
  topics: Topic[];
  loading: boolean;
  selectedTopicId: string;
  newTopicTitle: string;
  onNewTopicTitleChange: (title: string) => void;
  onCreateTopic: () => void;
  onRefreshTopics: () => void;
  onSelectTopic: (topicId: string) => void;
}

/**
 * TopicSidebar owns the left navigation rail: topic creation, refresh, and
 * selection. It stays presentation-only so dashboard state remains centralized.
 */
export function TopicSidebar({
  topics,
  loading,
  selectedTopicId,
  newTopicTitle,
  onNewTopicTitleChange,
  onCreateTopic,
  onRefreshTopics,
  onSelectTopic,
}: TopicSidebarProps) {
  return (
    <aside className="border-b border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/90 lg:border-b-0 lg:border-r">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">PCP</p>
          <h1 className="text-lg font-semibold text-slate-950 dark:text-white">Topics</h1>
        </div>
        <button
          className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          onClick={onRefreshTopics}
          title="Refresh topics"
          type="button"
        >
          <RefreshCw size={17} />
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-sky-950"
          value={newTopicTitle}
          onChange={(event) => onNewTopicTitleChange(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && onCreateTopic()}
          placeholder="new-topic"
        />
        <button
          className="rounded-md bg-slate-950 p-2 text-white hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
          onClick={onCreateTopic}
          title="Create topic"
          type="button"
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="space-y-1">
        {loading ? (
          <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">Loading topics...</div>
        ) : topics.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 px-3 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Create a topic to start recording sessions.
          </div>
        ) : topics.map((topic) => (
          <button
            key={topic.id}
            className={`group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${
              selectedTopicId === topic.id ? 'bg-slate-950 text-white hover:bg-slate-900 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300' : 'text-slate-700 dark:text-slate-300'
            }`}
            onClick={() => onSelectTopic(topic.id)}
            type="button"
          >
            <Folder size={17} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{topic.title}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${
              selectedTopicId === topic.id ? 'bg-white/15 text-white dark:bg-slate-950/15 dark:text-slate-950' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
            }`}>
              {topic.session_count}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}