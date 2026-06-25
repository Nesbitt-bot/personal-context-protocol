'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, Check, MessageSquare, Pencil, Trash2, X } from 'lucide-react';
import { formatDate } from './format';
import { Message } from './types';
import { diagnosticMessage, errorCause } from '@/lib/logging';

interface MessageListProps {
  sessionId: string;
  messages: Message[];
  onChanged: () => void;
  hasCompactions?: boolean;
}

const modelOf = (m: Message) => m.base_model || m.BaseModel || 'unknown';
const observedOf = (m: Message) => m.observed_at || m.observedAt;

/**
 * A message is a "user" bubble (right-aligned), an agent/assistant/system/tool/
 * correction bubble (left-aligned), or a system-level block (full-width).
 */
function isUserRole(role: string) {
  return role === 'user';
}

/**
 * Chat-style message view. User messages float right, all others float left.
 * Compaction/system messages span the full width. Scrolls independently within
 * its parent container. Multi-select, inline edit, and bulk delete remain.
 */
export function MessageList({ sessionId, messages, onChanged, hasCompactions = false }: MessageListProps) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  const [editingId, setEditingId] = useState('');
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isNearBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 80;

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) { el.scrollTop = el.scrollHeight; setAtBottom(true); }
  }, []);

  // Auto-scroll to latest messages on first load / when messages change and the user IS already at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom && messages.length > 0) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, atBottom]);

  // Scroll to bottom when switching sessions (sessionId changes).
  useEffect(() => {
    scrollToBottom();
  }, [sessionId]);

  // Track whether the user has scrolled up.
  function handleScroll() {
    const el = scrollRef.current;
    if (el) setAtBottom(isNearBottom(el));
  }

  function authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${localStorage.getItem('ui_token')}` };
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
    setLastIndex(null);
  }

  const allSelected = messages.length > 0 && selected.size === messages.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(messages.map((m) => m.id)));
  }

  function onCheckboxClick(index: number, id: string, event: React.MouseEvent) {
    if (event.shiftKey && lastIndex !== null) {
      const [a, b] = [Math.min(lastIndex, index), Math.max(lastIndex, index)];
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = a; i <= b; i += 1) next.add(messages[i].id);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
    setLastIndex(index);
  }

  async function saveEdit(id: string) {
    const content = editText.trim();
    if (!content) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error || 'Unable to edit message: session message correction / edit request - the server did not accept the change.');
        return;
      }
      setEditingId('');
      onChanged();
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to edit message',
        moduleProcess: 'session message correction / edit request',
        cause: `browser could not reach the edit endpoint; ${errorCause(err)}`,
      }));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} message(s)? This cannot be undone.`)) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/messages/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ message_ids: Array.from(selected) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error || 'Unable to delete messages: session message correction / delete request - the server did not accept the deletion.');
        return;
      }
      exitSelect();
      onChanged();
    } catch (err) {
      setError(diagnosticMessage({
        consequence: 'Unable to delete messages',
        moduleProcess: 'session message correction / delete request',
        cause: `browser could not reach the delete endpoint; ${errorCause(err)}`,
      }));
    } finally {
      setBusy(false);
    }
  }

  function bubbleTone(role: string, isUser: boolean) {
    if (isUser) return 'rounded-2xl rounded-br-md bg-sky-600 text-white shadow';
    if (role === 'assistant') return 'rounded-2xl rounded-bl-md border border-slate-200 bg-white text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
    return 'rounded-2xl rounded-bl-md border border-slate-200 bg-slate-100 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
  }

  function bubblePadding(role: string) {
    return isUserRole(role) ? 'px-4 py-3' : 'px-4 py-3';
  }

  return (
    <div className="flex min-h-0 flex-col">
      {/* Header bar — pinned top */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <MessageSquare size={18} className="text-sky-600 dark:text-sky-300" />
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Messages</h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{messages.length}</span>
        <div className="ml-auto flex items-center gap-2">
          {selectMode ? (
            <>
              <label className="flex cursor-pointer items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border-slate-300 dark:border-slate-700" />
                Select all
              </label>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40"
                onClick={deleteSelected}
                disabled={busy || selected.size === 0}
                type="button"
              >
                <Trash2 size={14} /> Delete ({selected.size})
              </button>
              <button className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" onClick={exitSelect} type="button">
                Done
              </button>
            </>
          ) : (
            messages.length > 0 && (
              <button
                className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                onClick={() => { setEditingId(''); setSelectMode(true); }}
                type="button"
              >
                Select / delete
              </button>
            )
          )}
        </div>
      </div>

      {error && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
      {selectMode && <p className="mb-3 text-xs text-slate-400">Shift-click to select a range. Messages are folded to 5 lines while selecting.</p>}

      {/* Scrollable message list */}
      <div className="relative min-h-0 flex-1 overflow-y-auto" ref={scrollRef} onScroll={handleScroll}>
        {!atBottom && messages.length > 8 && (
          <button
            className="sticky bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 shadow-md hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            onClick={scrollToBottom}
            type="button"
          >
            <ArrowDown size={14} className="mr-1.5 inline-block" />
            Latest messages
          </button>
        )}
        {messages.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {hasCompactions ? 'No raw messages recorded. This session has compact summaries.' : 'No messages recorded yet.'}
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {messages.map((message, index) => {
              const isEditing = editingId === message.id;
              const isUser = isUserRole(message.role);

              return (
                <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  {/* Left-side checkbox in select mode (only for non-user or any, shown on the left edge) */}
                  {selectMode && !isUser && (
                    <input
                      type="checkbox"
                      className="mr-2 mt-2 h-4 w-4 shrink-0 self-start rounded border-slate-300 dark:border-slate-700"
                      checked={selected.has(message.id)}
                      onChange={() => undefined}
                      onClick={(event) => onCheckboxClick(index, message.id, event)}
                    />
                  )}
                  {selectMode && isUser && (
                    <input
                      type="checkbox"
                      className="order-last ml-2 mt-2 h-4 w-4 shrink-0 self-start rounded border-slate-300 dark:border-slate-700"
                      checked={selected.has(message.id)}
                      onChange={() => undefined}
                      onClick={(event) => onCheckboxClick(index, message.id, event)}
                    />
                  )}

                  <article
                    className={`max-w-[85%] sm:max-w-[75%] ${bubbleTone(message.role, isUser)} ${bubblePadding(message.role)} ${selected.has(message.id) ? 'ring-2 ring-sky-400' : ''}`}
                  >
                    {/* Role badge + ordinal */}
                    <div className={`mb-1.5 flex items-center gap-2 text-xs ${isUser ? 'text-sky-200' : 'text-slate-500 dark:text-slate-400'}`}>
                      <span className="font-semibold uppercase tracking-wide">{message.role}</span>
                      <span className="tabular-nums">#{message.ordinal}</span>
                      {!selectMode && !isEditing && (
                        <button
                          className="rounded p-0.5 opacity-50 hover:opacity-100"
                          onClick={() => { setEditingId(message.id); setEditText(message.content); }}
                          type="button"
                          title="Edit message"
                          aria-label="Edit message"
                        >
                          <Pencil size={12} />
                        </button>
                      )}
                    </div>

                    {/* Content or editor */}
                    {isEditing ? (
                      <div>
                        <textarea
                          className="h-40 w-full resize-y rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          value={editText}
                          onChange={(event) => setEditText(event.target.value)}
                        />
                        <div className="mt-2 flex gap-2">
                          <button className="inline-flex items-center gap-1 rounded-md bg-slate-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-sky-400 dark:text-slate-950" onClick={() => saveEdit(message.id)} disabled={busy || !editText.trim()} type="button">
                            <Check size={13} /> Save
                          </button>
                          <button className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800" onClick={() => setEditingId('')} type="button">
                            <X size={13} /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className={`break-words text-sm leading-6 ${isUser ? 'text-white' : 'text-slate-900 dark:text-slate-100'} ${selectMode ? 'line-clamp-5' : 'whitespace-pre-wrap'}`}>{message.content}</p>
                    )}

                    {/* Meta footer */}
                    {!isEditing && (
                      <p className={`mt-2 text-xs ${isUser ? 'text-sky-200/70' : 'text-slate-500 dark:text-slate-400'}`}>
                        {(message.provider || 'unknown')}/{modelOf(message)} &middot; {formatDate(observedOf(message))}
                      </p>
                    )}
                  </article>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
