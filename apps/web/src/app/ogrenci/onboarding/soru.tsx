'use client';

import Image from 'next/image';
import { useActionState, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Check, Search } from 'lucide-react';
import mascot from '@ogrenmen/design-system/assets/Maskot/ogrenmen-maskot.webp';
import { buttonClasses, cn, Notice } from '@/ds';
import { enrollFromOnboarding, type OnboardingQuestionState } from './actions';
import { courseTextOf, ONBOARDING_CHIPS, type ChipId } from './shared';

export interface OnboardingQuestionProps {
  /** Görünür derslerin adları (arama kutusunun önerileri). */
  courseTitles: string[];
  /** Alt bağlantılar (rol değiştir, çıkış): sunucuda çizilir. */
  footer?: ReactNode;
}

/**
 * Onboarding (mockup S01; PLAN-v2 §13): iki ekran. 1) "Hangi sınava hazırlanıyorsun?" — arama kutusu + 6 çip, tek birincil "Devam".
 * 2) "Hedef tarihin?" — tek tarih alanı, tek birincil "Bitir", "Bilmiyorum" atlar.
 * Müfredat arka planda kurulur (onboarding_enroll); öğrenciye yalnız "Hazırlıyorum…" denir.
 */
/** Yerel takvimde bugün (YYYY-MM-DD); date alanının min değeri (yalnız istemcide, useEffect içinde okunur). */
function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function OnboardingQuestion({ courseTitles, footer }: OnboardingQuestionProps) {
  const [state, action, pending] = useActionState<OnboardingQuestionState, FormData>(enrollFromOnboarding, {});
  const [step, setStep] = useState<'ders' | 'tarih'>('ders');
  const [date, setDate] = useState('');
  // Sunucuda boş, istemcide yerel bugün: hidrasyon uyuşmazlığı olmaz
  const minDate = useSyncExternalStore(
    () => () => {},
    todayLocal,
    () => '',
  );
  // Ders adıyla ilgili sunucu hatası (ONB-001/003) ilk adıma döndürür (her yeni yanıtta bir kez)
  const [handled, setHandled] = useState<OnboardingQuestionState | null>(null);
  if (state.step === 'ders' && handled !== state) {
    setHandled(state);
    setStep('ders');
  }
  const [chip, setChip] = useState<ChipId | null>(null);
  const [typed, setTyped] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const text = courseTextOf(chip, typed);
  const needsText = chip === 'uni' || chip === 'diger';
  const canContinue = text.length >= 2;

  return (
    <form action={action} className="mx-auto flex min-h-dvh w-full max-w-md flex-col" noValidate>
      <input type="hidden" name="ders" value={text} />
      {step === 'tarih' ? (
        <>
          <div className="flex flex-1 flex-col gap-8 px-6 pt-12 pb-6">
            <div className="flex flex-col gap-4">
              <Image src={mascot} alt="" width={72} height={72} className="size-18 object-contain" priority />
              <h1 className="text-title-1 m-0 text-ink">Hedef tarihin?</h1>
            </div>
            <div className="flex flex-col gap-4">
              <label className="sr-only" htmlFor="hedef-tarih">
                Hedef tarih
              </label>
              <input
                id="hedef-tarih"
                name="tarih"
                type="date"
                value={date}
                min={minDate || undefined}
                onChange={(e) => setDate(e.target.value)}
                className="text-body box-border h-12 w-full rounded-lg border border-line-strong bg-surface-raised px-4 text-ink focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              />
              {state.error ? (
                <Notice tone="warning" live>
                  {state.error}
                </Notice>
              ) : null}
            </div>
          </div>
          <footer className="flex flex-col items-center gap-3 bg-surface px-6 pt-4 pb-8">
            <button type="submit" disabled={pending || !date} aria-busy={pending || undefined} className={buttonClasses({ variant: 'primary', size: 'lg', block: true })}>
              Bitir
            </button>
            <button type="submit" name="atla" value="1" disabled={pending} className={buttonClasses({ variant: 'quiet', size: 'md' })}>
              Bilmiyorum
            </button>
          </footer>
        </>
      ) : (
        <>
      <div className="flex flex-1 flex-col gap-8 px-6 pt-12 pb-6">
        <div className="flex flex-col gap-4">
          <Image src={mascot} alt="Öğrenmen maskotu el sallıyor" width={72} height={72} className="size-18 object-contain" priority />
          <p className="text-body m-0 text-ink-muted">Merhaba, ben Öğrenmen. Planını ben kuracağım.</p>
          <h1 id="sinav-baslik" className="text-title-1 m-0 text-ink">
            Hangi sınava hazırlanıyorsun?
          </h1>
        </div>
        <div className="flex flex-col gap-4">
          <div className="relative">
            <label className="sr-only" htmlFor="sinav-ara">
              Sınav veya ders ara
            </label>
            <Search aria-hidden="true" size={20} strokeWidth={1.75} className="pointer-events-none absolute top-3.5 left-4 text-ink-muted" />
            <input
              ref={input}
              id="sinav-ara"
              type="search"
              list="ders-onerileri"
              autoComplete="off"
              placeholder={needsText ? 'Dersin ya da sınavın adı' : 'Ara'}
              value={typed}
              maxLength={120}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                // Enter formu göndermez; birinci ekranda "Devam" gibi çalışır
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (canContinue) setStep('tarih');
                }
              }}
              className="text-body box-border h-12 w-full rounded-lg border border-line-strong bg-surface-raised pr-3 pl-12 text-ink placeholder:text-ink-muted focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            />
            <datalist id="ders-onerileri">
              {courseTitles.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <div role="group" aria-labelledby="sinav-baslik" className="grid grid-cols-2 gap-3">
            {ONBOARDING_CHIPS.map((c) => {
              const on = chip === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setChip(on ? null : c.id);
                    if (!on && c.text === null) input.current?.focus();
                  }}
                  className={cn(
                    'text-body flex min-h-14 cursor-pointer items-center justify-between gap-2 rounded-lg border px-4 text-left text-ink',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    on ? 'border-primary bg-primary-soft font-semibold ring-1 ring-inset ring-primary' : 'border-line bg-surface-raised font-medium hover:bg-surface-sunken',
                  )}
                >
                  {c.label}
                  {on ? <Check aria-hidden="true" size={20} strokeWidth={1.75} className="text-primary" /> : null}
                </button>
              );
            })}
          </div>
          {state.error ? (
            <Notice tone="warning" live>
              {state.error}
            </Notice>
          ) : null}
        </div>
      </div>
      <footer className="flex flex-col gap-3 bg-surface px-6 pt-4 pb-8">
        <button type="button" disabled={!canContinue} onClick={() => setStep('tarih')} className={buttonClasses({ variant: 'primary', size: 'lg', block: true })}>
          Devam
        </button>
        {footer}
      </footer>
        </>
      )}
    </form>
  );
}
