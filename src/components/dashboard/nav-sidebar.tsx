'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, Folder, FolderPlus, Inbox, MessageSquare, Plus, RefreshCw, Search } from 'lucide-react';
import { formatDate } from './format';
import { Session, Topic } from './types';
import { ContextMenu, ContextMenuItem } from './context-menu';

export const UNCATEGORIZED = '__none__';

interface NavSidebarProps {
  topics: Topic[];
  sessions: Session[];
  loading: boolean;
  selectedSessionId: string;
  expanded: Set<string>;
  query: string;
  showArchived: boolean;
  onToggleExpand: (groupId: string) => void;
  onQueryChange: (query: string) => void;
  onShowArchivedChange: (showArchived: boolean) => void;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: (topicId: string | null) => void;
  onCreateTopic: () => void;
  onRefresh: () => void;
  onRenameTopic: (topicId: string) => void;
  onRemoveTopic: (topicId: string) => void;
  onRemoveSession: (sessionId: string) => void;
}

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/**
 * ChatGPT-style navigation: topics are collapsible groups (dropdowns) and their
 * sessions are nested items. Uncategorized (no-topic) sessions get their own
 * group. Right-click or long-press an item to remove it.
 */
export function NavSidebar({
  topics,
  sessions,
  loading,
  selectedSessionId,
  expanded,
  query,
  showArchived,
  onToggleExpand,
  onQueryChange,
  onShowArchivedChange,
  onSelectSession,
  onCreateSession,
  onCreateTopic,
  onRefresh,
  onRenameTopic,
  onRemoveTopic,
  onRemoveSession,
}: NavSidebarProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const visibleSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((session) => {
      if (!showArchived && session.archived) return false;
      if (!q) return true;
      return session.title.toLowerCase().includes(q);
    });
  }, [sessions, query, showArchived]);

  const byTopic = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const session of visibleSessions) {
      const key = session.topic_id ?? UNCATEGORIZED;
      const list = map.get(key);
      if (list) list.push(session);
      else map.set(key, [session]);
    }
    return map;
  }, [visibleSessions]);

  const activeTopics = useMemo(
    () => topics.filter((topic) => showArchived || !topic.archived),
    [topics, showArchived],
  );

  const uncategorized = byTopic.get(UNCATEGORIZED) || [];

  /** Long-press (touch) opens the same menu as right-click. */
  function pressHandlers(items: ContextMenuItem[]) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    return {
      onContextMenu: (event: React.MouseEvent) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, items });
      },
      onTouchStart: (event: React.TouchEvent) => {
        const touch = event.touches[0];
        timer = setTimeout(() => setMenu({ x: touch.clientX, y: touch.clientY, items }), 500);
      },
      onTouchEnd: clear,
      onTouchMove: clear,
    };
  }

  function sessionItems(session: Session): ContextMenuItem[] {
    return [{ label: 'Remove', danger: true, onClick: () => onRemoveSession(session.id) }];
  }

  function topicItems(topic: Topic): ContextMenuItem[] {
    return [
      { label: 'Rename', onClick: () => onRenameTopic(topic.id) },
      { label: 'New session here', onClick: () => onCreateSession(topic.id) },
      { label: 'Remove', danger: true, onClick: () => onRemoveTopic(topic.id) },
    ];
  }

  function renderSession(session: Session) {
    return (
      <button
        key={session.id}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${
          selectedSessionId === session.id
            ? 'bg-slate-950 text-white hover:bg-slate-900 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300'
            : 'text-slate-700 dark:text-slate-300'
        } ${session.archived ? 'opacity-60' : ''}`}
        onClick={() => onSelectSession(session.id)}
        type="button"
        {...pressHandlers(sessionItems(session))}
      >
        <MessageSquare size={15} className="shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate">{session.title}</span>
      </button>
    );
  }

  function renderGroup(key: string, label: string, icon: React.ReactNode, groupSessions: Session[], menuItems?: ContextMenuItem[]) {
    const isOpen = expanded.has(key);
    return (
      <div key={key} className="mb-1">
        <button
          className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          onClick={() => onToggleExpand(key)}
          type="button"
          {...(menuItems ? pressHandlers(menuItems) : {})}
        >
          <ChevronRight size={15} className={`shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          {icon}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 group-hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400">
            {groupSessions.length}
          </span>
        </button>
        {isOpen && (
          <div className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2 dark:border-slate-800">
            {groupSessions.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-slate-400">No sessions</p>
            ) : (
              groupSessions.map(renderSession)
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-white/90 p-3 dark:border-slate-800 dark:bg-slate-950/90 lg:border-b-0 lg:border-r">
      <div className="mb-3 flex items-center gap-2">
        <button
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
          onClick={() => onCreateSession(null)}
          type="button"
        >
          <Plus size={16} /> New session
        </button>
        <button
          className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          onClick={onCreateTopic}
          title="New topic"
          type="button"
        >
          <FolderPlus size={17} />
        </button>
        <button
          className="rounded-md border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          onClick={onRefresh}
          title="Refresh"
          type="button"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="mb-2 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900">
        <Search size={15} className="text-slate-400" />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-950 outline-none placeholder:text-slate-400 dark:text-slate-100"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search sessions"
        />
      </div>

      <label className="mb-3 flex cursor-pointer items-center gap-2 px-1 text-xs text-slate-500 dark:text-slate-400">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => onShowArchivedChange(event.target.checked)}
          className="h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-700"
        />
        Show archived
      </label>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">Loading...</div>
        ) : (
          <>
            {renderGroup(UNCATEGORIZED, 'Uncategorized', <Inbox size={15} className="shrink-0 opacity-70" />, uncategorized)}
            {activeTopics.map((topic) =>
              renderGroup(
                topic.id,
                topic.title,
                <Folder size={15} className="shrink-0 opacity-70" />,
                byTopic.get(topic.id) || [],
                topicItems(topic),
              ),
            )}
            {activeTopics.length === 0 && uncategorized.length === 0 && (
              <div className="rounded-md border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Start a new session or topic.
              </div>
            )}
          </>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </aside>
  );
}
