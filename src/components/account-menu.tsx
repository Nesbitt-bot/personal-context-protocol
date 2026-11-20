'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { SignedInUser } from '@/lib/client-auth';

export function Avatar({ user }: { user: SignedInUser }) {
  const [failed, setFailed] = useState('');
  const initials = user.display_name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase();
  return user.picture_url && failed !== user.picture_url
    ? <img src={user.picture_url} onError={() => setFailed(user.picture_url!)} referrerPolicy="no-referrer" alt="" width={36} height={36} className="h-9 w-9 rounded-full object-cover" />
    : <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-800 text-sm font-semibold text-white">{initials || '?'}</span>;
}
const item = 'block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800';
export function AccountMenu({ user, logout }: { user: SignedInUser; logout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div ref={root} className="relative" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
    <button ref={button} type="button" className="block rounded-full" aria-label={`Account: ${user.display_name}`} aria-expanded={open} aria-controls="account-options" onClick={() => setOpen(!open)}><Avatar user={user} /></button>
    {open && <div id="account-options" className="absolute right-0 top-full mt-2 w-40 rounded border bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <Link className={item} href="/profile" onClick={() => setOpen(false)}>Profile</Link>
      <Link className={item} href="/settings" onClick={() => setOpen(false)}>Settings</Link>
      <button className={item} type="button" onClick={() => { setError(false); logout().catch(() => setError(true)); }}>Logout</button>
      {error && <p role="alert" className="px-3 py-2 text-sm">Sign-out failed. Reload and try again.</p>}
    </div>}
  </div>;
}
