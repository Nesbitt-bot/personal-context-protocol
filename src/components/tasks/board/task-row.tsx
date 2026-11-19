'use client';

import { useLights, PresenceLight } from '@/components/presence';

import { useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { CalendarDays, CheckCircle2, ChevronRight, Circle, Clock, MessageSquare, Pencil } from 'lucide-react';
import { progressLabel } from '@/lib/task-types';
import { dueDateInput, relativeTime, toDueIso } from './time';
import { ProjectTagInput } from './project-tag-input';
import type { DropZone, TaskRowProps } from './types';

function zoneFor(e: DragEvent<HTMLElement>): DropZone {
  const rect = e.currentTarget.getBoundingClientRect();
  const ratio = (e.clientY - rect.top) / Math.max(1, rect.height);
  if (ratio < 0.25) return 'before';
  if (ratio > 0.75) return 'after';
  return 'child';
}

function stop(e: MouseEvent) {
  e.stopPropagation();
}

/** One task row with inline edit controls, selection highlight and native drag & drop. */
export function TaskRow(props: TaskRowProps) {
  const lights = useLights();
  const { task, depth, grouped, collapsed, selected, projects, draggedId } = props;
  const [editing, setEditing] = useState<'title' | 'due' | null>(null);
  const [editingPriority, setEditingPriority] = useState(false);
  const [draft, setDraft] = useState('');
  const [dueDraft, setDueDraft] = useState('');
  const [overZone, setOverZone] = useState<DropZone | null>(null);

  function commitTitle() {
    setEditing(null);
    const next = draft.trim();
    if (next && next !== task.title) props.onRename(task, next);
  }

  const highlight =
    overZone === 'child'
      ? 'ring-2 ring-inset ring-sky-400'
      : overZone === 'before'
        ? 'shadow-[inset_0_2px_0_0_#38bdf8]'
        : overZone === 'after'
          ? 'shadow-[inset_0_-2px_0_0_#38bdf8]'
          : '';

  const titleClass = task.completed
    ? 'text-slate-400 line-through dark:text-slate-500'
    : 'text-slate-900 dark:text-slate-100';

  return (
    <div
      data-presence={lights.tasks[task.id]}
      draggable={!editing}
      onClick={() => props.onSelect(task)}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
        props.onDragStart(task);
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(e) => {
        if (!draggedId || draggedId === task.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOverZone(zoneFor(e));
      }}
      onDragLeave={() => setOverZone(null)}
      onDrop={(e) => {
        e.preventDefault();
        setOverZone(null);
        const id = e.dataTransfer.getData('text/plain') || draggedId;
        if (!id || id === task.id) return;
        props.onDropOnTask(id, task, zoneFor(e));
      }}
      style={{ paddingLeft: grouped ? 12 + depth * 20 : undefined }}
      className={`group flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/40 ${selected ? 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40' : 'border-transparent'} ${highlight}`}
    >
      <button
        className="shrink-0 rounded-full text-slate-400 hover:text-emerald-500"
        onClick={(e) => {
          stop(e);
          props.onToggleCompleted(task);
        }}
        aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
        type="button"
      >
        {task.completed ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Circle size={18} />}
      </button>

      {grouped && task.subtask_count > 0 && (
        <button
          className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          onClick={(e) => {
            stop(e);
            props.onToggleCollapsed(task);
          }}
          aria-label={collapsed ? 'Expand subtasks' : 'Collapse subtasks'}
          type="button"
        >
          <ChevronRight size={14} className={`transition-transform ${collapsed ? '' : 'rotate-90'}`} />
        </button>
      )}

      {editing === 'title' ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTitle}
          onClick={stop}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTitle();
            else if (e.key === 'Escape') setEditing(null);
          }}
          className="min-w-0 flex-1 rounded-md border border-sky-400 bg-white px-2 py-0.5 text-sm outline-none dark:bg-slate-950"
          aria-label="Task title"
        />
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button onClick={(e) => { stop(e); props.onOpen(task); }} className={`min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline ${titleClass}`} type="button">
            <PresenceLight task state={lights.tasks[task.id]} />{task.title}
          </button>
          <button
            className="shrink-0 rounded p-0.5 text-slate-400 opacity-0 hover:text-slate-600 group-hover:opacity-100 dark:hover:text-slate-300"
            onClick={(e) => {
              stop(e);
              setDraft(task.title);
              setEditing('title');
            }}
            aria-label="Rename task"
            type="button"
          >
            <Pencil size={12} />
          </button>
        </div>
      )}

      <div className="relative shrink-0" onClick={stop}>
        <ProjectTagInput
          task={task}
          projects={projects}
          onSave={(ids, prim) => props.onSetProjects(task, ids, prim)}
          onCreate={props.onCreateProject}
          busy={false}
        />
      </div>

      {editing === 'due' ? (
        <input
          autoFocus
          type="date"
          value={dueDraft}
          onChange={(e) => {
            setEditing(null);
            props.onSetDue(task, e.target.value ? toDueIso(e.target.value) : null);
          }}
          onBlur={() => setEditing(null)}
          onClick={stop}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(null);
          }}
          className="shrink-0 rounded-md border border-sky-400 bg-white px-2 py-0.5 text-xs outline-none dark:bg-slate-950"
          aria-label="Due date"
        />
      ) : (
        <button
          className={`inline-flex w-24 shrink-0 items-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs hover:border-slate-200 dark:hover:border-slate-700 ${task.due_at ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}
          onClick={(e) => {
            stop(e);
            setDueDraft(dueDateInput(task.due_at));
            setEditing('due');
          }}
          type="button"
        >
          <CalendarDays size={12} /> <span className="truncate">{task.due_at ? dueDateInput(task.due_at) : 'Due'}</span>
        </button>
      )}

      <div className="relative shrink-0" onClick={stop}>
        <button
          className={`hidden w-10 shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-xs sm:inline-flex ${task.priority === 0 ? 'bg-rose-100 font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : task.priority === null ? 'text-slate-300 hover:bg-slate-100 dark:text-slate-600 dark:hover:bg-slate-800' : 'text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800'}`}
          onClick={(e) => { stop(e); setEditingPriority((v) => !v); }}
          title={task.priority === null ? 'Set priority' : `Priority ${task.priority}`}
          type="button"
        >
          {task.priority === null ? '—' : `P${task.priority}`}
        </button>
        {editingPriority && (
          <>
            <button className="fixed inset-0 z-10 cursor-default" onClick={(e) => { stop(e); setEditingPriority(false); }} aria-label="Close priority picker" tabIndex={-1} type="button" />
            <div className="absolute right-0 top-full z-20 mt-1 w-28 rounded-md border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900" onClick={stop}>
              {[null, 0, 1, 2, 3].map((p) => (
                <button
                  key={String(p)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800 ${task.priority === p ? 'font-semibold text-sky-700 dark:text-sky-300' : 'text-slate-700 dark:text-slate-200'}`}
                  onClick={() => { setEditingPriority(false); props.onSetPriority(task, p); }}
                  type="button"
                >
                  <span>{p === null ? 'Empty' : `P${p}`}</span>
                  {p === 0 && <span className="text-[10px] text-rose-500">urgent</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <span className="hidden w-14 shrink-0 text-xs text-slate-500 dark:text-slate-400 sm:inline-block" title="Progress (current turns / expected turns)">
        {progressLabel(task) || '—'}
      </span>

      <span className="hidden w-10 shrink-0 items-center justify-center gap-1 text-xs text-slate-400 dark:text-slate-500 sm:inline-flex" title={`${task.session_count} bound session${task.session_count === 1 ? '' : 's'}`}>
        <MessageSquare size={12} />
        {task.session_count}
      </span>

      <span className="hidden w-24 shrink-0 items-center justify-end gap-1 text-xs text-slate-500 dark:text-slate-400 sm:inline-flex" title="Last updated (session activity)">
        <Clock size={12} />
        {relativeTime(task.last_activity_at ?? task.updated_at)}
      </span>
    </div>
  );
}
