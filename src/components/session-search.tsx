'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { uiAuthHeaders } from '@/lib/client-auth';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import type { SearchMode, SearchScope } from '@/lib/search-options';

export function searchUrl(q: string, scope: SearchScope, mode: SearchMode) {
  const params = new URLSearchParams({ q });
  if (scope !== 'all') params.set('scope', scope);
  if (mode !== 'keyword') params.set('mode', mode);
  return `/search?${params}`;
}

type Suggestion = { text: string; count: number };

export function SessionSearch({ query = '', scope = 'all', mode = 'keyword', label = 'Search PCP', onQueryChange }: {
  query?: string; scope?: SearchScope; mode?: SearchMode; label?: string; onQueryChange?: (q: string) => void;
}) {
  const router = useRouter();
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [value, setValue] = useState(query);
  const [enabled, setEnabled] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const open = enabled && suggestions.length > 0;

  useEffect(() => {
    const q = value.trimStart();
    if (!enabled || !q) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/v1/search/suggestions', {
          method: 'POST', cache: 'no-store', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...uiAuthHeaders() },
          body: JSON.stringify({ q, scope }),
        });
        if (!response.ok) return;
        const { suggestions: items } = await response.json() as { suggestions: Suggestion[] };
        if (!controller.signal.aborted && Array.isArray(items)) setSuggestions(items);
      } catch {
        // Completions are optional; a failed or cancelled request must not block search.
      }
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value, scope, enabled]);

  useEffect(() => {
    if (open && active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function dismiss() {
    setEnabled(false);
    setActive(-1);
    setSuggestions([]);
  }

  function navigate(text: string) {
    const q = text.trim();
    if (!q) return;
    dismiss();
    setValue(q);
    router.push(searchUrl(q, scope, mode));
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      if (enabled) { event.preventDefault(); dismiss(); }
      return;
    }
    const last = suggestions.length - 1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open) { setEnabled(true); return; }
      event.preventDefault();
      setActive(event.key === 'ArrowDown' ? (active >= last ? 0 : active + 1) : (active <= 0 ? last : active - 1));
    } else if (open && event.key === 'Tab') {
      const next = event.shiftKey ? (active < 0 ? last : active - 1) : active + 1;
      if (next < 0 || next > last) return; // Native Tab leaves the input; blur closes the list.
      event.preventDefault();
      setActive(next);
    } else if (open && event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      navigate(suggestions[active].text);
    }
  }

  return <form role="search" action="/search" className="relative flex min-w-0 flex-1 items-center" onSubmit={event => {
    event.preventDefault();
    navigate(value);
  }}>
    {scope !== 'all' && <input type="hidden" name="scope" value={scope} />}
    {mode !== 'keyword' && <input type="hidden" name="mode" value={mode} />}
    <input name="q" type="search" role="combobox" value={value} autoComplete="off" required maxLength={500}
      aria-label={label} placeholder={label} aria-autocomplete="list" aria-expanded={open}
      aria-controls={open ? listId : undefined} aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      aria-describedby={`${listId}-help`} onFocus={() => setEnabled(true)} onBlur={dismiss} onKeyDown={handleKey}
      onChange={event => { setValue(event.target.value); onQueryChange?.(event.target.value); setActive(-1); setSuggestions([]); setEnabled(true); }}
      className="w-full rounded-md border border-slate-300 bg-white py-2 pl-3 pr-9 text-sm dark:border-slate-700 dark:bg-slate-900" />
    <span id={`${listId}-help`} className="sr-only">Use the arrow keys or Tab and Shift+Tab to browse suggestions. Enter searches; Escape closes suggestions.</span>
    <button type="submit" aria-label="Submit search" className="absolute inset-y-0 right-0 px-3"><Search size={16} /></button>
    {open && <ul ref={listRef} id={listId} role="listbox" aria-label="Keyword suggestions"
      className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-300 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
      {suggestions.map(({ text, count }, i) => <li key={text} id={`${listId}-${i}`} role="option" aria-selected={active === i}
        onMouseDown={event => event.preventDefault()} onClick={() => navigate(text)}
        className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 ${active === i ? 'bg-sky-100 dark:bg-sky-950' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
        <span className="min-w-0 break-words">{text}</span>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">{count}<span className="sr-only"> {count === 1 ? 'match' : 'matches'}</span></span>
      </li>)}
    </ul>}
  </form>;
}
