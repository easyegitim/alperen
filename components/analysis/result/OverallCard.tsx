"use client";

import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScoreRing } from "@/components/analysis/ScoreRing";
import { Card } from "@/components/ui/card";
import type { OverallV2, PotentialV2 } from "@/lib/score/contract";
import { fmt1, formatPercentile, formatRange } from "./format";

/**
 * Genel skor (KB §4.5–4.8): tek ondalık + aralık satırı + (bayrakla) yüzdelik + rakip ölçeği notu + "YZ tahmini" notu.
 * Potansiyel çipi (≤ +1,5; her kazanç bir plan adımına bağlı) yalnız potansiyel bölümü açılınca gelir.
 */
export function OverallCard({ overall, potential, potentialReady }: { overall: OverallV2 | null; potential: PotentialV2 | null; potentialReady: boolean }) {
  const t = useTranslations("analysis");
  const tr = useTranslations("analysis.result");
  const range = overall?.range ? formatRange(overall.range) : null;
  const pct = formatPercentile(overall?.percentile);
  const value = overall?.value ?? null;
  return (
    <section aria-labelledby="overall-h">
      <Card className="bg-hero-glow gap-0 overflow-hidden pt-6 pb-5">
        <div className="flex flex-col items-center gap-3 px-5">
          <h2 id="overall-h" className="eyebrow">
            {t("overallTitle")}
          </h2>
          <ScoreRing value={value} animate>
            {value === null ? (
              <p className="text-sm text-muted-foreground">{tr("missing")}</p>
            ) : (
              <p className="flex flex-col items-center" aria-label={range ? tr("overallAria", { value: fmt1(value), lo: range.lo, hi: range.hi }) : undefined}>
                <span className="num text-display text-brand-gradient pr-[0.04em]" aria-hidden="true">
                  {fmt1(value)}
                </span>
                <span className="sr-only">{fmt1(value)}</span>
                <span className="num mt-1 text-sm font-medium text-muted-foreground">{t("hero.outOf")}</span>
              </p>
            )}
          </ScoreRing>
          {range ? (
            <div className="text-center">
              <p className="num text-sm font-semibold">{t("rangeLabel", { lo: range.lo, hi: range.hi })}</p>
              <p className="text-[11px] text-muted-foreground">{tr("rangeNote")}</p>
            </div>
          ) : null}
          {pct ? <p className="num rounded-full bg-brand-soft px-3 py-1 text-[13px] font-semibold">{t("percentileV2", { p: pct.p, suffix: pct.suffix })}</p> : null}
          {potentialReady && potential ? (
            <div className="flex flex-col items-center gap-1.5">
              <p className="border-brand-gradient inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold motion-safe:animate-fade-up">
                <ArrowUpRight className="size-4 text-brand" aria-hidden="true" />
                <span className="num">{potential.delta < 0.1 ? tr("potentialAtTop") : tr("potentialChip", { potential: fmt1(potential.value), delta: fmt1(potential.delta) })}</span>
              </p>
              <p className="num text-[11px] text-muted-foreground">{tr("potentialRange", { lo: fmt1(potential.range[0]), hi: fmt1(potential.range[1]) })}</p>
              <p className="text-center text-xs text-muted-foreground">{tr("potentialCaption")}</p>
            </div>
          ) : null}
        </div>
        <div className="mt-4 space-y-1.5 border-t bg-muted/40 px-5 pt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
          <p>{t("competitorsNote")}</p>
          <p>{t("scoreNote")}</p>
        </div>
      </Card>
    </section>
  );
}
