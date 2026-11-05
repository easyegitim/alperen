"use client";

import { ArrowUpRight, ChevronDown, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { fmtScore } from "@/components/analysis/LockedValue";
import { CALIBRATION_REFERENCE } from "@/lib/config/scoring";

/**
 * Sonuç ekranının tek açıklama alanı (F08): uzun yöntem metinleri varsayılan kapalı bir açılır bölümde.
 * Sabit skor notu (SPEC 4.3) altında her zaman görünür kalır.
 */
export function MethodDisclosure({ hybrid }: { hybrid: boolean }) {
  const t = useTranslations("analysis");
  const tg = useTranslations("geometry");
  return (
    <section className="space-y-3">
      <details className="group rounded-2xl border bg-card shadow-card">
        <summary className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl px-4 text-sm font-semibold">
          <Info className="size-4 shrink-0 text-brand" aria-hidden="true" />
          <span className="flex-1">{t("reference.methodLink")}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-3 px-4 pb-4 text-[13px] leading-relaxed text-muted-foreground">
          <p>{t("reference.note", { ref: fmtScore(CALIBRATION_REFERENCE) })}</p>
          {hybrid ? <p>{t("subsLegend")}</p> : null}
          <p>{hybrid ? tg("noteV2") : tg("note")}</p>
          <Link
            href="/yontem?from=result"
            className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand underline-offset-4 hover:underline"
          >
            {t("method.full")}
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </details>
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">{hybrid ? t("disclaimerHybrid") : t("disclaimer")}</p>
    </section>
  );
}
