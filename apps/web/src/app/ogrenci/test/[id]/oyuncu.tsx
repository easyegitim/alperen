'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useReducer, useRef } from 'react';
import { X } from 'lucide-react';
import { Button, cn, FigureFrame, MathText, Notice, QuizOption, TextField } from '@/ds';
import { answerPracticeAction, finishPracticeAction } from '@/server/practice/actions';
import { canSubmit, dotStates, initPlayer, isLastOpen, playerReducer } from '@/server/practice/machine';
import type { PlayerItem } from '@/server/practice/types';

export interface PlayerProps {
  setId: string;
  items: PlayerItem[];
}

/**
 * Test oynatıcısı (mockup S04): ekranda yalnız Kapat, ilerleme noktaları, soru, şekil, şıklar ve "Sonraki".
 * Her cevap answer_practice_item ile hemen kaydedilir (doğru/yanlış soru başına gösterilmez); son sorudan sonra
 * finish_practice ve sonuç ekranı (S05). Durum makinesi: src/server/practice/machine.ts.
 */
export function Player({ setId, items }: PlayerProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(playerReducer, undefined, () =>
    initPlayer(
      items.map((i) => ({ no: i.no, answered: i.answered, correct: i.correct })),
      Date.now(),
    ),
  );
  const item = items[state.index];
  const finishing = useRef(false);

  // Gönderim: submitting evresine girince cevabı kaydet.
  useEffect(() => {
    if (state.phase !== 'submitting' || !item || !state.selected) return;
    let cancelled = false;
    const answer = state.selected;
    const ms = Date.now() - state.shownAt;
    answerPracticeAction({ setId, questionId: item.questionId, answer, responseMs: ms })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) dispatch({ type: 'ANSWERED', no: item.no, correct: r.correct, at: Date.now() });
        else if (r.closed) router.replace(`/ogrenci/test/${setId}/sonuc`);
        else dispatch({ type: 'FAILED', message: r.message });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'FAILED', message: 'Kaydedemedim. Bağlantını kontrol edip yeniden dene.' });
      });
    return () => {
      cancelled = true;
    };
  }, [state.phase, state.selected, state.shownAt, item, setId, router]);

  // Bitiş: finishing evresinde bir kez finish_practice, sonra sonuç ekranı.
  useEffect(() => {
    if (state.phase !== 'finishing' || finishing.current) return;
    finishing.current = true;
    finishPracticeAction(setId)
      .then((r) => {
        if (r.ok) {
          dispatch({ type: 'FINISHED' });
          router.replace(r.href);
        } else {
          finishing.current = false;
          dispatch({ type: 'FINISH_FAILED', message: r.message });
        }
      })
      .catch(() => {
        finishing.current = false;
        dispatch({ type: 'FINISH_FAILED', message: 'Sonucu alamadım. Yeniden dene.' });
      });
  }, [state.phase, setId, router]);

  // Soru değişince başa kaydır.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [state.index]);

  const dots = dotStates(state);
  const total = items.length;
  const current = state.index + 1;
  const busy = state.phase === 'submitting' || state.phase === 'finishing' || state.phase === 'done';
  const last = isLastOpen(state);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-48px)] w-full max-w-xl flex-col">
      <header className="grid h-16 grid-cols-[44px_1fr_44px] items-center gap-2">
        <Link href="/ogrenci" aria-label="Kapat" className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-sunken hover:text-ink">
          <X aria-hidden="true" size={24} strokeWidth={1.75} />
        </Link>
        <div role="progressbar" aria-label={`Soru ${current} / ${total}`} aria-valuemin={1} aria-valuemax={total} aria-valuenow={current} className="flex flex-wrap items-center justify-center gap-2.5" data-testid="ilerleme">
          {dots.map((d, i) => (
            <span key={i} data-state={d} className={cn('box-border inline-block size-2 rounded-full', d === 'done' && 'bg-primary', d === 'current' && 'border-2 border-primary', d === 'todo' && 'bg-line')} />
          ))}
        </div>
        <span aria-hidden="true" />
      </header>

      {item && state.phase !== 'finishing' && state.phase !== 'done' && state.phase !== 'error' ? (
        <>
          <div className="flex flex-1 flex-col gap-8 pt-6 pb-6">
            <div className="flex flex-col gap-6">
              <h1 id="soru" className="text-title-3 m-0 text-ink" data-testid="soru">
                <MathText>{item.stem}</MathText>
              </h1>
              {item.figure ? <FigureFrame src={item.figure.src} alt={item.figure.alt} className="w-full" /> : null}
            </div>
            {item.kind === 'mcq' ? (
              <div
                role="radiogroup"
                aria-labelledby="soru"
                className="flex flex-col gap-2.5"
                onKeyDown={(e) => {
                  // Roving tabindex: ok tuşları seçimi taşır (yerel radyo düğmeleri gibi)
                  const keys = item.options.map((o) => o.key);
                  const at = keys.indexOf(state.selected ?? '');
                  const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
                  if (!step || busy || keys.length === 0) return;
                  e.preventDefault();
                  const next = at < 0 ? (step > 0 ? 0 : keys.length - 1) : (at + step + keys.length) % keys.length;
                  dispatch({ type: 'SELECT', value: keys[next]! });
                  const radios = e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]');
                  radios[next]?.focus();
                }}
              >
                {item.options.map((o, idx) => {
                  const sel = state.selected === o.key;
                  const tabStop = state.selected == null ? idx === 0 : sel;
                  return (
                    <QuizOption
                      key={o.key}
                      letter={o.key}
                      role="radio"
                      aria-pressed={undefined}
                      aria-checked={sel}
                      tabIndex={tabStop ? 0 : -1}
                      state={sel ? 'selected' : 'idle'}
                      disabled={busy}
                      onClick={() => dispatch({ type: 'SELECT', value: o.key })}
                    >
                      <MathText>{o.text}</MathText>
                    </QuizOption>
                  );
                })}
              </div>
            ) : (
              <TextField
                label="Cevabın"
                inputMode="decimal"
                autoComplete="off"
                value={state.selected ?? ''}
                disabled={busy}
                onChange={(e) => dispatch({ type: 'SELECT', value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    dispatch({ type: 'SUBMIT' });
                  }
                }}
                mono
              />
            )}
            {state.error ? (
              <Notice tone="warning" live>
                {state.error}
              </Notice>
            ) : null}
          </div>
          <footer className="sticky bottom-0 bg-surface pt-4 pb-6">
            <Button variant="primary" size="lg" block disabled={!canSubmit(state)} aria-busy={state.phase === 'submitting' || undefined} onClick={() => dispatch({ type: 'SUBMIT' })}>
              {last ? 'Bitir' : 'Sonraki'}
            </Button>
          </footer>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center" aria-live="polite">
          {state.phase === 'error' ? (
            <>
              <p className="text-body m-0 text-ink">{state.error}</p>
              <Button variant="primary" size="lg" onClick={() => dispatch({ type: 'RETRY_FINISH' })}>
                Yeniden dene
              </Button>
            </>
          ) : (
            <p className="text-title-3 m-0 text-ink">Sonucunu hazırlıyorum…</p>
          )}
        </div>
      )}
    </div>
  );
}
