'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { ChevronRight, Folder, GitBranch, Inbox, Pencil } from 'lucide-react';
import type { TaskCategory, TaskItem } from '@/lib/task-types';
import { buildForest } from './forest';
import { TaskRow } from './task-row';
import type { RowContext, ViewMode } from './types';

/** Sentinel for the "Unassigned" pseudo-category (which has no topic id). */
export const UNASSIGNED_GROUP_KEY = '__unassigned__';

/** Column legend shared by every view (list, category, project). */
export function BoardHeader() {
  return (
    <div className="mb-1 flex items-center gap-2 border-b border-slate-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
      <span className="w-[18px] shrink-0" />
      <span className="min-w-0 flex-1">Task</span>
      <span className="hidden w-40 shrink-0 sm:block">Project</span>
      <span className="w-24 shrink-0">Due</span>
      <span className="hidden w-10 shrink-0 text-center sm:block">Urgent</span>
      <span className="hidden w-14 shrink-0 sm:block">Progress</span>
      <span className="hidden w-10 shrink-0 text-center sm:block">Sessions</span>
      <span className="hidden w-24 shrink-0 text-right sm:block">Updated</span>
    </div>
  );
}

function Branch(props: {
  item: TaskItem;
  depth: number;
  collapsedMap: Record<string, boolean>;
  selectedId: string | null;
  children: Map<string, TaskItem[]>;
  ctx: RowContext;
}) {
  const { item, depth, collapsedMap, selectedId, children, ctx } = props;
  const isCollapsed = Boolean(collapsedMap[item.id]);
  return (
    <>
      <TaskRow task={item} depth={depth} collapsed={isCollapsed} selected={selectedId === item.id} {...ctx} />
      {!isCollapsed &&
        (children.get(item.id) ?? []).map((child) => (
          <Branch key={child.id} item={child} depth={depth + 1} collapsedMap={collapsedMap} selectedId={selectedId} children={children} ctx={ctx} />
        ))}
    </>
  );
}

function GroupSummary(props: {
  title: string;
  icon: ReactNode;
  count: number;
  draggedId: string | null;
  selected: boolean;
  onSelect: () => void;
  onRename?: (title: string) => void;
  categoryId?: string | null;
  onDropCategory?: (draggedId: string, categoryId: string | null) => void;
}) {
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const droppable = Boolean(props.onDropCategory) && props.categoryId !== undefined && Boolean(props.draggedId);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== props.title) props.onRename?.(next);
  }

  return (
    <summary
      className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 ${props.selected || over ? 'ring-2 ring-inset ring-sky-400' : ''}`}
      onClick={() => props.onSelect()}
      onDragOver={(e) => {
        if (!props.draggedId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!props.draggedId || !props.onDropCategory) return;
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/plain') || props.draggedId;
        props.onDropCategory(id, props.categoryId ?? null);
      }}
    >
      <ChevronRight size={14} className="shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
      {props.icon}
      {props.onRename ? (
        editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') setEditing(false);
            }}
            className="min-w-0 flex-1 rounded-md border border-sky-400 bg-white px-2 py-0.5 text-sm font-semibold outline-none dark:bg-slate-950"
            aria-label="Category name"
          />
        ) : (
          <button
            className="group/rename inline-flex min-w-0 flex-1 items-center gap-1"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setDraft(props.title);
              setEditing(true);
            }}
            type="button"
          >
            <span className="min-w-0 truncate text-sm font-semibold text-slate-900 hover:underline dark:text-slate-100">{props.title}</span>
            <Pencil size={12} className="shrink-0 text-slate-400 opacity-0 transition-opacity group-hover/rename:opacity-100" />
          </button>
        )
      ) : (
        <span className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{props.title}</span>
      )}
      <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
        {props.count} task{props.count === 1 ? '' : 's'}
      </span>
      {droppable && over && <span className="shrink-0 text-xs text-sky-500">Drop to move</span>}
    </summary>
  );
}

function Group(props: {
  title: string;
  icon: ReactNode;
  groupKey: string;
  roots: TaskItem[];
  count: number;
  children: Map<string, TaskItem[]>;
  collapsedMap: Record<string, boolean>;
  selectedId: string | null;
  selectedKey: string | null;
  ctx: RowContext;
  categoryId?: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  onRename?: (title: string) => void;
  onDropCategory?: (draggedId: string, categoryId: string | null) => void;
}) {
  const { roots, children, collapsedMap, selectedId, ctx } = props;
  return (
    <details open className="group rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <GroupSummary
        title={props.title}
        icon={props.icon}
        count={props.count}
        draggedId={ctx.draggedId}
        selected={props.selectedKey === props.groupKey}
        onSelect={() => props.onSelectCategory(props.categoryId ?? null)}
        onRename={props.onRename}
        categoryId={props.categoryId}
        onDropCategory={props.onDropCategory}
      />
      <div className="px-2 pb-2">
        {roots.length === 0 && <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">No tasks.</p>}
        {roots.map((root) => (
          <Branch key={root.id} item={root} depth={0} collapsedMap={collapsedMap} selectedId={selectedId} children={children} ctx={ctx} />
        ))}
      </div>
    </details>
  );
}

/** Grouped (category or project) rendering of the given tasks. */
export function BoardGroups(props: {
  view: Exclude<ViewMode, 'list'>;
  pageTasks: TaskItem[];
  allTasks: TaskItem[];
  categories: TaskCategory[];
  collapsedMap: Record<string, boolean>;
  selectedId: string | null;
  selectedKey: string | null;
  ctx: RowContext;
  onSelectCategory: (categoryId: string | null) => void;
  onRenameCategory: (categoryId: string, title: string) => void;
  onDropCategory: (draggedId: string, categoryId: string | null) => void;
}) {
  const forest = buildForest(props.pageTasks);
  const fullForest = buildForest(props.allTasks);

  if (props.view === 'category') {
    return (
      <div className="space-y-3">
        {props.categories.map((c) => {
          const roots = forest.roots.filter((t) => t.topic_id === c.id);
          const fullRoots = fullForest.roots.filter((t) => t.topic_id === c.id);
          return (
            <Group
              key={c.id}
              title={c.title}
              icon={<Folder size={14} className="shrink-0 text-slate-400" />}
              groupKey={c.id}
              roots={roots}
              count={fullRoots.length}
              children={forest.children}
              collapsedMap={props.collapsedMap}
              selectedId={props.selectedId}
              selectedKey={props.selectedKey}
              ctx={props.ctx}
              categoryId={c.id}
              onSelectCategory={props.onSelectCategory}
              onRename={(title) => props.onRenameCategory(c.id, title)}
              onDropCategory={props.onDropCategory}
            />
          );
        })}
        {(() => {
          const roots = forest.roots.filter((t) => t.topic_id === null);
          const fullRoots = fullForest.roots.filter((t) => t.topic_id === null);
          return (
            <Group
              title="Unassigned"
              icon={<Inbox size={14} className="shrink-0 text-slate-400" />}
              groupKey={UNASSIGNED_GROUP_KEY}
              roots={roots}
              count={fullRoots.length}
              children={forest.children}
              collapsedMap={props.collapsedMap}
              selectedId={props.selectedId}
              selectedKey={props.selectedKey}
              ctx={props.ctx}
              categoryId={null}
              onSelectCategory={props.onSelectCategory}
              onDropCategory={props.onDropCategory}
            />
          );
        })()}
      </div>
    );
  }

  const nameByProjectId = new Map(props.ctx.projects.map((p) => [p.id, p.display_name]));
  const groupKeys: string[] = [];
  const seen = new Set<string>();
  for (const t of props.allTasks) {
    if (t.project_ids.length === 0) {
      if (!seen.has('No project')) {
        seen.add('No project');
        groupKeys.push('No project');
      }
      continue;
    }
    for (const pid of t.project_ids) {
      const key = nameByProjectId.get(pid) ?? pid;
      if (!seen.has(key)) {
        seen.add(key);
        groupKeys.push(key);
      }
    }
  }

  return (
    <div className="space-y-3">
      {groupKeys.map((key) => {
        const roots = forest.roots.filter((t) => {
          if (key === 'No project') return t.project_ids.length === 0;
          return t.project_ids.some((pid) => (nameByProjectId.get(pid) ?? pid) === key);
        });
        const fullRoots = fullForest.roots.filter((t) => {
          if (key === 'No project') return t.project_ids.length === 0;
          return t.project_ids.some((pid) => (nameByProjectId.get(pid) ?? pid) === key);
        });
        return (
          <Group
            key={key}
            title={key}
            icon={key === 'No project' ? <Inbox size={14} className="shrink-0 text-slate-400" /> : <GitBranch size={14} className="shrink-0 text-slate-400" />}
            groupKey={key}
            roots={roots}
            count={fullRoots.length}
            children={forest.children}
            collapsedMap={props.collapsedMap}
            selectedId={props.selectedId}
            selectedKey={props.selectedKey}
            ctx={props.ctx}
            onSelectCategory={props.onSelectCategory}
          />
        );
      })}
    </div>
  );
}
