'use client';

import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
}

interface ModalProps {
  /** Visible title; also the dialog's accessible name. */
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Header row content next to the title (e.g. a Copy button). The close button is always added. */
  actions?: ReactNode;
  /** Tailwind max-width class for the panel. */
  widthClass?: string;
  /** Extra classes for the header row (tone). */
  headerClass?: string;
  panelClass?: string;
  icon?: ReactNode;
}

/**
 * Accessible modal dialog shared by every overlay in the app.
 *
 * Rendered through a portal on `document.body`: an overlay rendered inside an
 * ancestor with `backdrop-filter`, `filter` or `transform` (the sticky
 * `backdrop-blur` top nav, animated sections) is positioned relative to that
 * ancestor instead of the viewport, which is what pushed the token manager
 * above the top of the screen. The panel is capped to the viewport height and
 * scrolls internally. Focus moves into the dialog, Tab/Shift+Tab stay inside
 * it, Esc and the close button close it, and focus returns to the element
 * that opened it.
 */
export function Modal({ title, onClose, children, actions, widthClass = 'max-w-lg', headerClass = '', panelClass = '', icon }: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  onCloseRef.current = onClose;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const preferred = panel.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
      (preferred || focusables(panel).find((el) => el.dataset.modalClose === undefined) || panel).focus();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const items = focusables(panelRef.current);
      if (items.length === 0) { event.preventDefault(); panelRef.current.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !panelRef.current.contains(active))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/40 p-4 sm:items-center"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[calc(100dvh-2rem)] w-full ${widthClass} flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl outline-none dark:border-slate-700 dark:bg-slate-900 ${panelClass}`}
      >
        <div className={`flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800 ${headerClass}`}>
          <div className="flex min-w-0 items-center gap-2">
            {icon}
            <h2 id={titleId} className="min-w-0 break-words text-sm font-semibold text-slate-950 dark:text-white">{title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              onClick={onClose}
              type="button"
              aria-label="Close"
              data-modal-close=""
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
