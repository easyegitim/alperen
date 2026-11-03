import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/cn';
import { formatDelta, formatPercent } from '../lib/format';

/** Gözlem sayısı için varsayılan eşik (PLAN-v2 kanıt kuralı). */
export const DEFAULT_MIN_EVIDENCE = 5;
export const NO_EVIDENCE_TEXT = 'Henüz yeterli kanıt yok';

/** Bant eşikleri (PLAN-v2 §13: yüzde yerine bant): p < 0,5 Zayıf, p < 0,8 Orta, aksi halde İyi. */
export const MASTERY_BAND_THRESHOLDS = { weak: 0.5, good: 0.8 } as const;
export type MasteryBand = 'Zayıf' | 'Orta' | 'İyi';
export type MasteryFormat = 'band' | 'percent';

/** Ustalık olasılığını kelimeyle bantlar. Kanıt eşiği kontrolü masteryDisplay'dedir. */
export function masteryBand(p: number): MasteryBand {
  if (p < MASTERY_BAND_THRESHOLDS.weak) return 'Zayıf';
  if (p < MASTERY_BAND_THRESHOLDS.good) return 'Orta';
  return 'İyi';
}

export interface MasteryDisplay {
  /** Kanıt eşiği aşıldı mı; false ise yüzde YAZILMAZ, dolgu çizilmez. */
  enough: boolean;
  /** enough ise 0–100 tam sayı. */
  percent?: number;
  /** enough ise bant. */
  band?: MasteryBand;
  /** Değer alanında yazılacak metin: "%72" / "Orta" ya da "Henüz yeterli kanıt yok". */
  text: string;
}

/**
 * Kanıt kuralı: gözlem sayısı eşiğin altındaysa (ya da bilinmiyorsa) p ne olursa olsun yüzde gösterilmez.
 * Kesin teşhis kanıtla gelir.
 */
export function masteryDisplay(input: {
  p?: number;
  evidence?: number;
  minEvidence?: number;
  /** 'band' (varsayılan): Zayıf/Orta/İyi; 'percent': %72 (eğitmen konsolu). */
  format?: MasteryFormat;
}): MasteryDisplay {
  const { p, evidence, minEvidence = DEFAULT_MIN_EVIDENCE, format = 'band' } = input;
  const enough =
    typeof p === 'number' && Number.isFinite(p) && typeof evidence === 'number' && evidence >= minEvidence;
  if (!enough) return { enough: false, text: NO_EVIDENCE_TEXT };
  const band = masteryBand(p);
  return { enough: true, percent: Math.round(Math.max(0, Math.min(1, p)) * 100), band, text: format === 'percent' ? formatPercent(p) : band };
}

/** Bant kipinde sayı yerine kelime: değişim yönü. */
function deltaWord(delta: number): string {
  if (Math.abs(delta) < 0.01) return 'Sabit';
  return delta > 0 ? '↑ Yükseliyor' : '↓ Düşüyor';
}

export interface MasteryMeterProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  skill: string;
  /** Ustalık olasılığı 0–1 (mastery.p). */
  p?: number;
  /** Gözlem sayısı. */
  evidence?: number;
  minEvidence?: number;
  /** Son dönemdeki değişim, -1..1. Kanıt yeterliyse gösterilir. */
  delta?: number;
  deltaLabel?: string;
  /** Dönem etiketi ("LGS 2026"): ustalık döneme bağlıdır. */
  period?: string;
  /** Gösterim: 'band' (varsayılan; öğrenci ve veli) ya da 'percent' (eğitmen konsolu). */
  display?: MasteryFormat;
}

/** Kazanım başına ustalık göstergesi; kanıt eşiğin altındaysa "Henüz yeterli kanıt yok" yazar. */
export function MasteryMeter({
  skill,
  p,
  evidence,
  minEvidence = DEFAULT_MIN_EVIDENCE,
  delta,
  deltaLabel,
  period,
  display = 'band',
  className,
  ...rest
}: MasteryMeterProps) {
  const d = masteryDisplay({ p, evidence, minEvidence, format: display });
  return (
    <div {...rest} className={cn('flex min-w-60 flex-col gap-1', className)} data-enough={d.enough}>
      <div className="text-label flex items-baseline justify-between gap-3">
        <span className="text-ink">{skill}</span>
        <span className={cn('whitespace-nowrap tabular-nums', d.enough ? 'font-semibold text-ink' : 'font-medium text-ink-muted')}>
          {d.text}
        </span>
      </div>
      <div
        {...(d.enough
          ? {
              role: 'meter',
              'aria-label': `${skill} ustalığı`,
              'aria-valuemin': 0,
              'aria-valuemax': 100,
              'aria-valuenow': d.percent,
              'aria-valuetext': d.text,
              'data-band': d.band,
            }
          : { 'aria-hidden': true })}
        className={cn(
          'h-2 overflow-hidden rounded-sm',
          d.enough ? 'bg-primary-soft' : 'bg-surface-sunken ring-1 ring-inset ring-line',
        )}
      >
        {d.enough ? (
          <div
            className="og-motion h-full rounded-r-sm bg-primary transition-[width] duration-300"
            style={{ width: `${d.percent}%` }}
          />
        ) : null}
      </div>
      <div className="text-caption flex justify-between gap-3 text-ink-muted">
        <span>
          {typeof evidence === 'number' ? `${evidence} gözlem` : 'Gözlem yok'}
          {period ? ` · ${period}` : ''}
        </span>
        {d.enough && typeof delta === 'number' ? (
          <span>
            <span className={cn('font-medium', delta >= 0 ? 'text-success' : 'text-danger')}>
              {display === 'percent' ? formatDelta(delta) : deltaWord(delta)}
            </span>
            {deltaLabel ? ` ${deltaLabel}` : ''}
          </span>
        ) : null}
      </div>
    </div>
  );
}
