'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { applyTheme, readStoredTheme, storeTheme, THEME_LABELS, THEME_PREFERENCES, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/cn';

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/** Tema seçici: Sistem (varsayılan), Açık, Koyu. Tercih localStorage'a yazılır ve <html data-theme> üzerine uygulanır. */
export function ThemeToggle({ className }: { className?: string }) {
  const [pref, setPref] = useState<ThemePreference>('system');

  useEffect(() => {
    // Depolanan tercih yalnız tarayıcıda okunabilir: ilk çizimden sonra eşitle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPref(readStoredTheme());
  }, []);

  function choose(next: ThemePreference) {
    setPref(next);
    storeTheme(next);
    applyTheme(next);
  }

  return (
    <div role="group" aria-label="Tema" className={cn('flex max-w-full rounded-md border border-line-strong bg-surface-raised p-0.5', className)}>
      {THEME_PREFERENCES.map((value) => {
        const Icon = ICONS[value];
        const selected = pref === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selected}
            onClick={() => choose(value)}
            className={cn(
              'text-small og-motion inline-flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 rounded-sm px-2 transition-colors duration-150',
              'focus-visible:outline-2 focus-visible:outline-transparent focus-visible:shadow-focus-ring',
              selected ? 'bg-primary text-on-primary' : 'text-ink hover:bg-surface-sunken',
            )}
          >
            <Icon aria-hidden="true" size={16} />
            {THEME_LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}
