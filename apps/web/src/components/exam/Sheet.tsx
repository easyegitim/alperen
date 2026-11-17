'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface SheetProps {
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Alt sayfa (mobil) / ortada kutu (geniş ekran): role="dialog", Escape ve arka plana dokunma kapatır, açılınca odak
 * kapat düğmesine gider, Tab diyalog içinde döner, arka plan etkisizdir (inert) ve kapanınca odak açan öğeye döner.
 */
export function Sheet({ label, onClose, children }: SheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // arka plan: kardeş öğeler etkisizleştirilir (odak ve ekran okuyucu); data-sheet-keep olanlar (canlı bölge) kalır
    const muted: Element[] = [];
    for (const el of Array.from(rootRef.current?.parentElement?.children ?? [])) {
      if (el === rootRef.current || el.hasAttribute('inert') || el.hasAttribute('data-sheet-keep')) continue;
      el.setAttribute('inert', '');
      el.setAttribute('aria-hidden', 'true');
      muted.push(el);
    }
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      const dialog = dialogRef.current;
      // yalnız en üstteki alt sayfa Tab'i yönetir (üstünde başkası varsa bu kutu etkisizdir)
      if (e.key !== 'Tab' || !dialog || dialog.closest('[inert]')) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((n) => !(n as HTMLButtonElement).disabled);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      for (const el of muted) {
        el.removeAttribute('inert');
        el.removeAttribute('aria-hidden');
      }
      opener?.focus?.();
    };
  }, []);

  return (
    <div ref={rootRef} className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center" onClick={onClose} data-testid="alt-sayfa">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-t-lg bg-surface-raised p-6 shadow-lg sm:rounded-lg"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-title-3 m-0 text-ink">{label}</h2>
          <button ref={closeRef} type="button" aria-label="Kapat" onClick={onClose} className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-surface-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            <X aria-hidden="true" size={24} strokeWidth={1.75} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
