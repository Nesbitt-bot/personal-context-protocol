'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Code2, Database, FolderGit2, KeyRound, Menu, MessageSquare, Settings, X } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';
import { ScopedTokenManager } from './dashboard/scoped-token-manager';
import { fetchSignedInUser, signOut, SignedInUser } from '@/lib/client-auth';

const ENTRY = 'inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white';
const ACTIVE = 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-100';
const MENU_ITEM = 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

/**
 * Shared top navigation for public and authenticated app pages.
 *
 * Signed-in users get Sessions (the dashboard) and Projects; admins also get
 * Tokens and Settings. The server enforces every one of these regardless of
 * what is shown. On narrow screens the entries move into a menu so nothing is
 * unreachable on a phone. After sign-in "Login" becomes "Logout" so the user
 * always knows whether a session is active.
 */
export function SiteNav() {
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [showTokens, setShowTokens] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const pathname = usePathname() || '/';
  const isAdmin = Boolean(user?.is_admin);

  useEffect(() => {
    fetchSignedInUser().then(setUser);
  }, []);

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') setMenuOpen(false); }
    function onPointer(event: MouseEvent) { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false); }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onPointer); };
  }, [menuOpen]);

  async function logout() {
    await signOut();
    setUser(null);
    router.push('/');
  }

  const links = user
    ? [
        { href: '/dashboard', label: 'Sessions', icon: MessageSquare, active: pathname.startsWith('/dashboard') || pathname.startsWith('/sessions') },
        { href: '/projects', label: 'Projects', icon: FolderGit2, active: pathname.startsWith('/projects') },
        ...(isAdmin ? [{ href: '/settings', label: 'Settings', icon: Settings, active: pathname.startsWith('/settings') }] : []),
      ]
    : [];

  return (
    <nav className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="inline-flex min-w-0 items-center gap-3 text-slate-950 dark:text-slate-50">
          <span className="rounded-md bg-slate-950 p-2 text-white dark:bg-sky-400 dark:text-slate-950">
            <Database size={18} />
          </span>
          <span className="truncate text-sm font-semibold">Personal Context Protocol</span>
        </Link>
        <div className="flex items-center gap-2">
          {links.map(({ href, label, icon: Icon, active }) => (
            <Link key={href} href={href} className={`hidden md:inline-flex ${ENTRY} ${active ? ACTIVE : ''}`} aria-current={active ? 'page' : undefined}>
              <Icon size={16} /> {label}
            </Link>
          ))}
          {isAdmin && (
            <button className={`hidden md:inline-flex ${ENTRY}`} onClick={() => setShowTokens(true)} type="button">
              <KeyRound size={16} /> Tokens
            </button>
          )}
          <a className={`hidden lg:inline-flex ${ENTRY}`} href="https://github.com/Nesbitt-bot/personal-context-protocol" rel="noreferrer" target="_blank">
            <Code2 size={16} /> Source
          </a>
          {user && (
            <span className="hidden max-w-[12rem] truncate text-sm text-slate-500 dark:text-slate-400 xl:inline" title={user.method === 'break_glass' ? 'Break-glass admin token' : 'Signed in with Casdoor'}>
              {user.display_name}
            </span>
          )}
          <ThemeToggle />
          {user ? (
            <button
              className="hidden rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300 sm:inline-flex"
              onClick={logout}
              type="button"
            >
              Logout
            </button>
          ) : (
            <Link
              className="rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
              href={`/login${pathname.startsWith('/login') || pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`}`}
            >
              Login
            </Link>
          )}
          {user && (
            <div className="relative md:hidden" ref={menuRef}>
              <button
                ref={menuButtonRef}
                className={ENTRY}
                onClick={() => setMenuOpen((open) => !open)}
                type="button"
                aria-expanded={menuOpen}
                aria-controls="pcp-nav-menu"
                aria-label="Menu"
              >
                {menuOpen ? <X size={16} /> : <Menu size={16} />}
              </button>
              {menuOpen && (
                <div id="pcp-nav-menu" className="absolute right-0 top-full mt-2 w-56 rounded-md border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  <p className="truncate px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{user.display_name}</p>
                  {links.map(({ href, label, icon: Icon, active }) => (
                    <Link key={href} href={href} className={`${MENU_ITEM} ${active ? 'bg-sky-50 text-sky-900 dark:bg-sky-950/50 dark:text-sky-100' : ''}`} aria-current={active ? 'page' : undefined}>
                      <Icon size={16} /> {label}
                    </Link>
                  ))}
                  {isAdmin && (
                    <button className={MENU_ITEM} onClick={() => { menuButtonRef.current?.focus(); setMenuOpen(false); setShowTokens(true); }} type="button">
                      <KeyRound size={16} /> Tokens
                    </button>
                  )}
                  <button className={`${MENU_ITEM} sm:hidden`} onClick={logout} type="button">Logout</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {showTokens && <ScopedTokenManager onClose={() => setShowTokens(false)} />}
    </nav>
  );
}
