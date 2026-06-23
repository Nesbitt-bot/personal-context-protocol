'use client';

import { LucideIcon, Monitor, Moon, Sun } from 'lucide-react';
import { ThemeMode, useTheme } from './theme-provider';

const options: Array<{ value: ThemeMode; label: string; icon: LucideIcon }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/**
 * Compact segmented control for switching between explicit light/dark modes
 * and following the operating system preference.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      {options.map((option) => {
        const Icon = option.icon;
        const active = theme === option.value;
        return (
          <button
            key={option.value}
            className={`inline-flex h-8 min-w-8 items-center justify-center rounded px-2 text-xs font-medium transition ${
              active
                ? 'bg-slate-950 text-white dark:bg-sky-400 dark:text-slate-950'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
            }`}
            onClick={() => setTheme(option.value)}
            title={`${option.label} theme`}
            type="button"
          >
            <Icon size={15} />
            <span className="sr-only">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}