import { APP_VERSION } from '@/lib/version';

const docsBaseUrl = 'https://nesbitt-bot.github.io/personal-context-protocol/';

const links = [
  { label: 'Documentation', href: docsBaseUrl },
  { label: 'API reference', href: `${docsBaseUrl}protocol.html` },
  { label: 'Deployment guide', href: `${docsBaseUrl}deployment-vercel-neon.html` },
  { label: 'Future work', href: `${docsBaseUrl}TODO.html` },
];

/**
 * Footer links keep the deployed app connected to the published GitHub Pages
 * documentation and explain the mission without duplicating the full docs.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white px-4 py-8 dark:border-slate-800 dark:bg-slate-950 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xl">
          <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">Personal Context Protocol</p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
            A scoped context layer for AI sessions: humans organize the workspace, agents append evidence, and exports stay reviewable.
          </p>
          <p className="mt-3 font-mono text-xs text-slate-400 dark:text-slate-500" title="Deployed app version">
            v{APP_VERSION}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {links.map((link) => (
            <a
              key={link.href}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              href={link.href}
              rel="noreferrer"
              target="_blank"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}