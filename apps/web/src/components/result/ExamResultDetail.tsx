'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { HeatRow, ItemLine, SectionBar } from '@/server/exam-result/present';
import { howFarHref } from '@/server/exam-result/present';
import { ExamHeatmap } from './ExamHeatmap';

export interface ExamResultDetailProps {
  sessionId: string;
  counts: string | null;
  keyNote: string | null;
  sections: SectionBar[];
  heat: HeatRow[];
  items: ItemLine[];
  /** Veli görünümünde yanlış/boş listesi gizlenir. */
  itemsHidden?: boolean;
}

/**
 * "Detay" (katlı): bölüm netleri çubukları, kazanım ısı haritası, yanlış/boş listesi. Her satırda tek eylem
 * "Nereye kadar geldim?" (sade sayfa: fotoğraf çek / yaz / Hiç başlayamadım / Süre yetmedi).
 */
export function ExamResultDetail({ sessionId, counts, keyNote, sections, heat, items, itemsHidden = false }: ExamResultDetailProps) {
  return (
    <div className="flex flex-col gap-8">
      {counts ? <p className="text-body m-0 text-ink">{counts}</p> : null}
      {keyNote ? (
        <p className="text-small m-0 text-ink-muted" data-testid="anahtar-notu">
          {keyNote}
        </p>
      ) : null}

      {sections.length > 0 ? (
        <section aria-labelledby="bolumler" className="flex flex-col gap-3" data-testid="bolum-netleri">
          <h2 id="bolumler" className="text-label m-0 text-ink">
            Bölümler
          </h2>
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {sections.map((s) => (
              <li key={s.section} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-small font-medium text-ink">{s.title}</span>
                  <span className="text-small font-medium text-ink tabular-nums">{s.netText}</span>
                </div>
                <div aria-hidden="true" className="h-2 overflow-hidden rounded-sm bg-surface-sunken ring-1 ring-inset ring-line">
                  <div className="h-full rounded-sm bg-primary" style={{ width: `${Math.round(s.fill * 100)}%` }} />
                </div>
                <span className="text-caption text-ink-muted">{s.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {heat.length > 0 ? (
        <section aria-labelledby="kazanimlar" className="flex flex-col gap-3">
          <h2 id="kazanimlar" className="text-label m-0 text-ink">
            Kazanımlar
          </h2>
          <ExamHeatmap rows={heat} />
        </section>
      ) : null}

      {!itemsHidden ? (
        <section aria-labelledby="yanlis-bos" className="flex flex-col gap-1" data-testid="yanlis-bos">
          <h2 id="yanlis-bos" className="text-label m-0 pb-2 text-ink">
            Yanlış ve boşlar
          </h2>
          {items.length === 0 ? (
            <p className="text-body m-0 text-ink-muted">Yanlış ya da boş sorun yok.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {items.map((it) => (
                <li key={it.responseId} className="border-t border-line">
                  {it.actionable ? (
                    <Link href={howFarHref(sessionId, it.responseId)} className="flex min-h-13 items-center justify-between gap-3 rounded-md py-2 text-ink no-underline">
                      <span className="flex min-w-0 flex-col">
                        <span className="text-label font-normal">{it.title}</span>
                        {it.note ? <span className="text-caption text-ink-muted">{it.note}</span> : null}
                      </span>
                      <span className="text-small flex shrink-0 items-center gap-1 text-primary">
                        {it.action}
                        <ChevronRight aria-hidden="true" size={18} />
                      </span>
                    </Link>
                  ) : (
                    <div className="flex min-h-13 items-center justify-between gap-3 py-2">
                      <span className="text-label font-normal text-ink">{it.title}</span>
                      <span className="text-small shrink-0 text-ink-muted">{it.action}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
