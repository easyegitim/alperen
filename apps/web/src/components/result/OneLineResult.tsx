'use client';

import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { buttonClasses, cn, MathText } from '@/ds';

export interface ResultScore {
  correct: number;
  total: number;
  /** Ekran okuyucu metni ("8 sorudan 6 doğru"). */
  label: string;
}

export interface OneLineResultProps {
  /** Büyük skor ("6/8"); teşhis sonucunda verilmez. */
  score?: ResultScore;
  /** Soru sırasıyla doğru (true), yanlış (false), cevapsız (null) noktaları. */
  dots?: Array<boolean | null>;
  /** Tek cümle sonuç: sayfanın h1'i. */
  sentence: string;
  /** "Neyi öğrendik" tek satır (formül içerebilir). */
  learned?: string | null;
  /** Tek birincil düğme ("Devam et"). */
  primary: { href: string; label: string };
  /** Katlı ayrıntı: "Detay" düğmesi aynı ekranda açar. */
  detail?: ReactNode;
  /** Verilirse "Detay" başka sayfaya gider (detail verilmediyse). */
  detailHref?: string;
  /** "Koça sor" küçük bağlantısı. */
  coachHref?: string;
  /** Üstte maskot gibi ek görsel. */
  top?: ReactNode;
}

/**
 * Sonuç ekranı (mockup S05; PLAN-v2 §13 "tek cümle sonuç"): isteğe bağlı skor + noktalar, tek cümle (h1),
 * "Neyi öğrendik" kartı; altta tek birincil "Devam et", sessiz "Detay" (katlı) ve küçük "Koça sor".
 * Test (alıştırma) ve teşhis sonuçları aynı bileşeni kullanır.
 */
export function OneLineResult({ score, dots, sentence, learned, primary, detail, detailHref, coachHref, top }: OneLineResultProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const hasDetail = detail != null && detail !== false;
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-48px)] w-full max-w-md flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-2 py-8 text-center">
        {top}
        {score ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-display m-0 text-primary tabular-nums" data-testid="skor">
              <span aria-hidden="true">
                {score.correct}/{score.total}
              </span>
              <span className="sr-only">{score.label}</span>
            </p>
            {dots && dots.length > 0 ? (
              <div aria-hidden="true" className="flex flex-wrap justify-center gap-2" data-testid="sonuc-noktalari">
                {dots.map((d, i) => (
                  <span
                    key={i}
                    data-correct={d === null ? 'none' : String(d)}
                    className={cn('box-border inline-block size-2.5 rounded-full', d ? 'bg-primary' : 'border-2 border-line-strong')}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <h1 data-testid="tek-cumle" className="text-body-lg m-0 max-w-80 font-normal text-ink">
          {sentence}
        </h1>
        {learned ? (
          <div className="box-border flex w-full flex-col gap-1 rounded-lg border border-line bg-surface-raised px-5 py-4 text-left">
            <p className="text-caption m-0 text-ink-muted">Neyi öğrendik</p>
            <p className="text-body m-0 font-medium text-ink">
              <MathText>{learned}</MathText>
            </p>
          </div>
        ) : null}
        {hasDetail ? (
          <section id={panelId} hidden={!open} aria-label="Detay" data-testid="detay" className="box-border w-full text-left">
            {detail}
          </section>
        ) : null}
      </div>
      <div className="flex flex-col items-stretch gap-2 pt-4 pb-4">
        <Link href={primary.href} className={buttonClasses({ variant: 'primary', size: 'lg', block: true })}>
          {primary.label}
        </Link>
        {hasDetail ? (
          <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)} className={buttonClasses({ variant: 'quiet', size: 'lg', block: true })}>
            Detay
          </button>
        ) : detailHref ? (
          <Link href={detailHref} className={buttonClasses({ variant: 'quiet', size: 'lg', block: true })}>
            Detay
          </Link>
        ) : null}
        {coachHref ? (
          <Link href={coachHref} className="text-small inline-flex min-h-11 items-center self-center rounded-md px-3 text-ink-muted">
            Koça sor
          </Link>
        ) : null}
      </div>
    </div>
  );
}
