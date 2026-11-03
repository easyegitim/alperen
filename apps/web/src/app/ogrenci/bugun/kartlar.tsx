'use client';

import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';
import { BookOpenCheck, CalendarCheck, ChevronRight, FileText, ListChecks, RotateCcw, Target, Upload, type LucideIcon } from 'lucide-react';
import { buttonClasses, cn } from '@/ds';
import { openNotice, startFirstPractice, startSuggestion } from '@/server/suggestions/actions';

// Bugün ekranının (mockup S02) etkileşimli parçaları: her "Başla"/"Aç" bir sunucu eylemi formudur (JS'siz de çalışır);
// gönderim sürerken düğme kilitlenir.

const KIND_ICONS: Record<string, LucideIcon> = {
  practice: ListChecks,
  weekly_homework: CalendarCheck,
  lesson_review: RotateCcw,
  gap_analysis: Target,
  mini_exam: BookOpenCheck,
  document_ready: FileText,
  upload_result: Upload,
};

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

function Submit({ className, children, label }: { className: string; children: ReactNode; label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" aria-label={label} disabled={pending} aria-busy={pending || undefined} className={cn(className, 'disabled:cursor-progress disabled:opacity-70')}>
      {children}
    </button>
  );
}

export interface HeroProps {
  suggestionId: string;
  title: string;
  meta: string | null;
}

/** Kahraman kart: ekrandaki tek birincil düğme "Başla". */
export function HeroCard({ suggestionId, title, meta }: HeroProps) {
  return (
    <section aria-labelledby="oneri-baslik" data-testid="kahraman" className="flex flex-col gap-6 rounded-lg border border-line bg-surface-raised p-6 shadow-sm">
      <div className="flex flex-col gap-2">
        <p className="text-small m-0 font-medium text-primary">Bugün sana önerim</p>
        <h2 id="oneri-baslik" className="text-title-2 m-0 text-ink">
          {title}
        </h2>
        {meta ? <p className="text-body m-0 text-ink-muted">{meta}</p> : null}
      </div>
      <form action={startSuggestion}>
        <input type="hidden" name="suggestion" value={suggestionId} />
        <Submit className={buttonClasses({ variant: 'primary', size: 'lg', block: true })}>Başla</Submit>
      </form>
    </section>
  );
}

/** Yarım kalan test: kahraman kart, tek birincil "Devam et" (test ekranı kaldığı yerden sürer). */
export function ResumeCard({ setId, line }: { setId: string; line: string }) {
  return (
    <section aria-labelledby="oneri-baslik" data-testid="kahraman" className="flex flex-col gap-6 rounded-lg border border-line bg-surface-raised p-6 shadow-sm">
      <div className="flex flex-col gap-2">
        <p className="text-small m-0 font-medium text-primary">Kaldığın yerden</p>
        <h2 id="oneri-baslik" className="text-title-2 m-0 text-ink">
          Yarım kalan testin
        </h2>
        <p className="text-body m-0 text-ink-muted">{line}</p>
      </div>
      <Link href={`/ogrenci/test/${setId}`} className={buttonClasses({ variant: 'primary', size: 'lg', block: true })}>
        Devam et
      </Link>
    </section>
  );
}

/** Öneri yokken: koç ilk önerisini hazırlarken tek düğmeyle ilk test. */
export function FirstPracticeCard({ drafting }: { drafting: boolean }) {
  return (
    <section aria-labelledby="oneri-baslik" data-testid="kahraman" className="flex flex-col gap-6 rounded-lg border border-line bg-surface-raised p-6 shadow-sm">
      <div className="flex flex-col gap-2">
        <h2 id="oneri-baslik" className="text-title-2 m-0 text-ink">
          Koçun ilk önerini hazırlıyor
        </h2>
        <p className="text-body m-0 text-ink-muted">{drafting ? 'Planın kuruluyor; birkaç saniye sürer.' : 'Bu arada kısa bir testle başlayabilirsin.'}</p>
      </div>
      {drafting ? null : (
        <form action={startFirstPractice}>
          <Submit className={buttonClasses({ variant: 'primary', size: 'lg', block: true })}>İlk testine başla</Submit>
        </form>
      )}
    </section>
  );
}

export interface BoxProps {
  suggestionId: string;
  kind: string;
  kindLabel: string;
  title: string;
  line: string | null;
}

/** Diğer çalışmalar: en çok 3 kutu, her biri tek dokunuşla başlar. */
export function BoxCard({ suggestionId, kind, kindLabel, title, line }: BoxProps) {
  const Icon = KIND_ICONS[kind] ?? ListChecks;
  return (
    <li className="flex">
      <form action={startSuggestion} className="flex flex-1">
        <input type="hidden" name="suggestion" value={suggestionId} />
        <Submit
          label={`${title === kindLabel ? kindLabel : `${kindLabel}: ${title}`}${line ? `, ${line}` : ''}`}
          className={cn(
            'box-border flex min-h-30 flex-1 cursor-pointer flex-col justify-between gap-3 rounded-lg border border-line bg-surface-raised p-4 text-left text-ink hover:bg-surface-sunken',
            FOCUS,
          )}
        >
          <Icon aria-hidden="true" size={24} strokeWidth={1.75} className="text-primary" />
          <span className="flex flex-col gap-0.5">
            <span className="text-label">{kindLabel}</span>
            {line ? <span className="text-small text-ink-muted">{line}</span> : null}
          </span>
        </Submit>
      </form>
    </li>
  );
}

export interface NoticeProps {
  suggestionId: string;
  kind: string;
  title: string;
  line: string;
}

/** Belge hazır / yükleme sonucu kartı ("Aç"). */
export function NoticeCard({ suggestionId, kind, title, line }: NoticeProps) {
  const Icon = KIND_ICONS[kind] ?? FileText;
  return (
    <form action={openNotice}>
      <input type="hidden" name="suggestion" value={suggestionId} />
      <Submit
        label={`Aç: ${title}`}
        className={cn('box-border flex min-h-18 w-full cursor-pointer items-center gap-4 rounded-lg border border-line bg-surface-raised px-4 py-3 text-left text-ink hover:bg-surface-sunken', FOCUS)}
      >
        <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
          <Icon size={20} strokeWidth={1.75} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-label">{title}</span>
          <span className="text-small text-ink-muted">{line}</span>
        </span>
        <ChevronRight aria-hidden="true" size={20} className="shrink-0 text-ink-muted" />
      </Submit>
    </form>
  );
}
