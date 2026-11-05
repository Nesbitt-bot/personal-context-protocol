'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Code2, Database, KeyRound } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';
import { ScopedTokenManager } from './dashboard/scoped-token-manager';
import { fetchSignedInUser, signOut, SignedInUser } from '@/lib/client-auth';

/**
 * Shared top navigation for public and authenticated app pages.
 * After sign-in the "Login" button changes to "Logout" so the user always
 * knows whether a session is active. Admin-only tools (scoped tokens,
 * settings) are shown only to admins; the server enforces this regardless.
 */
export function SiteNav() {
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [showTokens, setShowTokens] = useState(false);
  const router = useRouter();
  const loggedIn = Boolean(user);
  const isAdmin = Boolean(user?.is_admin);

  useEffect(() => {
    fetchSignedInUser().then(setUser);
  }, []);

  async function logout() {
    await signOut();
    setUser(null);
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
          {isAdmin && (
            <button
              className="hidden rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white sm:inline-flex"
              onClick={() => setShowTokens(true)}
              type="button"
            >
              <KeyRound size={16} />
              <span className="ml-2">Tokens</span>
            </button>
          )}
          {isAdmin && (
            <Link
              className="hidden rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white sm:inline-flex"
              href="/settings"
            >
              Settings
            </Link>
          )}
          {user && (
            <span className="hidden max-w-[12rem] truncate text-sm text-slate-500 dark:text-slate-400 md:inline" title={user.method === 'break_glass' ? 'Break-glass admin token' : 'Signed in with Casdoor'}>
              {user.display_name}
            </span>
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
      {showTokens && <ScopedTokenManager onClose={() => setShowTokens(false)} />}
    </nav>
  );
}