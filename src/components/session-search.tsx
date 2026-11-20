'use client';
import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { uiAuthHeaders } from '@/lib/client-auth';

type Result = { id: string; title: string };
export function SessionSearch() {
  const ref = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController>();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  useEffect(() => {
    function outside(e: PointerEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('pointerdown', outside); pending.current?.abort(); };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const q = input.current?.value.trim();
    if (!q) return;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setOpen(true); setStatus('Searching…'); setResults([]);
    try {
      const res = await fetch('/api/v1/search', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...uiAuthHeaders() }, body: JSON.stringify({ q }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed.');
      setResults(data.results); setStatus(`${data.results.length} session${data.results.length === 1 ? '' : 's'} found${data.semantic ? '' : ' · keyword results'}`);
    } catch (err) { if (!controller.signal.aborted) setStatus(err instanceof Error ? err.message : 'Search unavailable.'); }
  }
  return <form role="search" ref={ref} onSubmit={submit} className="relative flex min-w-0 flex-1 items-center md:max-w-sm" onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); input.current?.focus(); } }}>
    <input ref={input} type="search" aria-label="Search sessions" placeholder="Search sessions" required maxLength={500} className="w-full rounded-md border bg-transparent py-2 pl-2 pr-8 text-sm dark:border-slate-700" />
    <button type="submit" aria-label="Submit search" className="absolute right-2"><Search size={16} /></button>
    {open && <section aria-label="Search results" className="fixed inset-x-2 top-full max-h-[65vh] overflow-auto rounded border bg-white p-2 shadow-lg sm:absolute sm:inset-x-0 sm:min-w-72 dark:border-slate-700 dark:bg-slate-900">
      <p role="status" className="px-2 py-1 text-sm text-slate-500">{status}</p>
      {results.map(r => <Link key={r.id} href={`/dashboard?session=${encodeURIComponent(r.id)}`} onClick={() => setOpen(false)} className="block rounded px-2 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">{r.title}</Link>)}
    </section>}
  </form>;
}
