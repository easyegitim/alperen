'use client';

import { useState, useTransition } from 'react';
import { PARENT_RULES, type RuleRow } from '@/lib/parent';
import { toggleEmail, toggleRule } from '@/app/veli/actions';

/** Bildirim kuralı anahtarları (tek sayfa): her satır bir anahtar; değişiklik hemen kaydedilir. */
export function RuleSwitches({ rules, action = toggleRule }: { rules: readonly RuleRow[]; action?: typeof toggleRule }) {
  const [state, setState] = useState<Record<string, boolean>>(() => Object.fromEntries(rules.map((r) => [r.kind, r.enabled])));
  const [error, setError] = useState(false);
  const [, start] = useTransition();

  const flip = (kind: string) => {
    const next = !(state[kind] ?? true);
    setState((s) => ({ ...s, [kind]: next }));
    setError(false);
    start(async () => {
      const res = await action(kind, next);
      if (!res.ok) {
        setState((s) => ({ ...s, [kind]: !next }));
        setError(true);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-lg border border-line bg-surface-raised p-0">
        {PARENT_RULES.map((r) => {
          const on = state[r.kind] ?? true;
          return (
            <li key={r.kind} className="flex min-h-16 items-center justify-between gap-4 px-4 py-3">
              <span className="flex min-w-0 flex-col">
                <span id={`kural-${r.kind}`} className="text-label text-ink">
                  {r.label}
                </span>
                <span className="text-small text-ink-muted">{r.hint}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-labelledby={`kural-${r.kind}`}
                onClick={() => flip(r.kind)}
                className="relative h-8 w-14 shrink-0 cursor-pointer rounded-full border-0 bg-line-strong transition-colors focus-visible:outline-none focus-visible:shadow-focus-ring aria-checked:bg-primary"
              >
                <span aria-hidden="true" className={`absolute top-1 left-1 size-6 rounded-full bg-surface-raised shadow-sm transition-transform ${on ? 'translate-x-6' : ''}`} />
              </button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="text-small m-0 text-danger">
          Ayar kaydedilemedi. Biraz sonra yeniden deneyin.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Tek anahtar "E-postayla da gönder" (plan §10 isteğe bağlı e-posta kanalı): açıkken bütün bildirim türleri e-postayla da
 * gelir. Tür başına ayrı e-posta ayarı yoktur (sadelik).
 */
export function EmailSwitch({ initial, action = toggleEmail }: { initial: boolean; action?: typeof toggleEmail }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState(false);
  const [, start] = useTransition();

  const flip = () => {
    const next = !on;
    setOn(next);
    setError(false);
    start(async () => {
      const res = await action(next);
      if (!res.ok) {
        setOn(!next);
        setError(true);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-16 items-center justify-between gap-4 rounded-lg border border-line bg-surface-raised px-4 py-3">
        <span className="flex min-w-0 flex-col">
          <span id="kural-eposta" className="text-label text-ink">
            E-postayla da gönder
          </span>
          <span className="text-small text-ink-muted">Seçtiğiniz bildirimler hesabınızın e-posta adresine de gelir.</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="kural-eposta"
          onClick={flip}
          className="relative h-8 w-14 shrink-0 cursor-pointer rounded-full border-0 bg-line-strong transition-colors focus-visible:outline-none focus-visible:shadow-focus-ring aria-checked:bg-primary"
        >
          <span aria-hidden="true" className={`absolute top-1 left-1 size-6 rounded-full bg-surface-raised shadow-sm transition-transform ${on ? 'translate-x-6' : ''}`} />
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-small m-0 text-danger">
          Ayar kaydedilemedi. Biraz sonra yeniden deneyin.
        </p>
      ) : null}
    </div>
  );
}
