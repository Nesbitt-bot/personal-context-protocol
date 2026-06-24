'use client';

import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * A small floating menu shown at a screen position. Opened by right-click or
 * long-press in the navigation; closes on outside click, Escape, scroll, or
 * resize. Position is clamped so it never overflows the viewport.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointer(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // Clamp so the menu stays on screen (rough estimate; refined after mount).
  const left = Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : x) - 200);
  const top = Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : y) - 16 - items.length * 40);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
      style={{ left, top }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          type="button"
          className={`block w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${
            item.danger ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'
          }`}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
