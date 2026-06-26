'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Code2, Database } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';

function hasUiToken() {
  if (typeof window === 'undefined') return false;
  return Boolean(localStorage.getItem('ui_token'));
}

/**
 * Shared top navigation for public and authenticated app pages.
 * After login the "Login portal" button changes to "Logout" so the
 * user always knows whether a session is active.
 */
export function SiteNav() {
  const [loggedIn, setLoggedIn] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setLoggedIn(hasUiToken());
  }, []);

  function logout() {
    localStorage.removeItem('ui_token');
    setLoggedIn(false);
    router.push('/');
  }

  return (
    <nav className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="inline-flex min-w-0 items-center gap-3 text-slate-950 dark:text-slate-50">
          <span className="rounded-md bg-slate-950 p-2 text-white dark:bg-sky-400 dark:text-slate-950">
            <Database size={18} />
          </span>
          <span className="truncate text-sm font-semibold">Personal Context Protocol</span>
        </Link>
        <div className="flex items-center gap-2">
          <a
            className="hidden rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white sm:inline-flex"
            href="https://github.com/Nesbitt-bot/personal-context-protocol"
            rel="noreferrer"
            target="_blank"
          >
            <Code2 size={16} />
            <span className="ml-2">Source</span>
          </a>
          {loggedIn && (
            <Link
              className="hidden rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white sm:inline-flex"
              href="/settings"
            >
              Settings
            </Link>
          )}
          <ThemeToggle />
          {loggedIn ? (
            <button
              className="rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
              onClick={logout}
              type="button"
            >
              Logout
            </button>
          ) : (
            <Link
              className="rounded-md bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
              href="/login"
            >
              Login
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}