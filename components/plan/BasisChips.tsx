"use client";

import { Pencil, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { track } from "@/lib/analytics";
import type { BasisChip } from "@/lib/coach/planTypes";

/** "Planın şunlara göre hazırlandı" (PLAN §3): her anket cevabı ve fotoğraf gerçeği; boy/kilo asla gelmez (sunucu yazmaz). */
export function BasisChips({ chips, analysisId, stale }: { chips: BasisChip[]; analysisId: string; stale: boolean }) {
  const t = useTranslations("plan.v2.basis");
  const tq = useTranslations("questionnaire.options");
  const tv = useTranslations("questionnaire.v2.options");
  const tg = useTranslations("geometry.shapes");
  const ta = useTranslations("onboarding.age.bands");
  const tp = useTranslations("onboarding.gender.options");

  const valueOf = (c: BasisChip): string => {
    const v = c.value ?? "";
    const has = (fn: { has: (k: string) => boolean }, k: string) => fn.has(k);
    switch (c.key) {
      case "goal":
        return has(tq, `goals.${v}`) ? tq(`goals.${v}`) : v;
      case "goalDirection":
        return has(tv, `goalDirection.${v}`) ? tv(`goalDirection.${v}`) : v;
      case "budget":
        return has(tv, `budget.${v}`) ? tv(`budget.${v}`) : v;
      case "oneTimeBudget":
        return has(tv, `oneTimeBudget.${v}`) ? tv(`oneTimeBudget.${v}`) : v;
      case "sportDays":
        return has(tv, `sportDays.${v}`) ? tv(`sportDays.${v}`) : v;
      case "work":
        return has(tv, `work.${v}`) ? tv(`work.${v}`) : v;
      case "hairLength":
        return has(tv, `hairLength.${v}`) ? tv(`hairLength.${v}`) : v;
      case "beardLength":
        return has(tv, `beardLength.${v}`) ? tv(`beardLength.${v}`) : v;
      case "skinType":
        return has(tq, `skinType.${v}`) ? tq(`skinType.${v}`) : v;
      case "glasses":
      case "headCovering":
        return `${v === "yes" ? t("yes") : t("no")}${c.source === "photo" ? ` (${t("fromPhoto")})` : ""}`;
      case "faceShape":
        return has(tg, v) ? tg(v) : v;
      case "ageBand":
        return has(ta, v) ? ta(v) : v;
      case "presentation":
        return has(tp, v) ? tp(v) : v;
      default:
        return v;
    }
  };

  const label = (c: BasisChip) => (c.key === "jawHealth" ? t("chip.jawHealth") : t(`chip.${c.key}`, { value: valueOf(c) }));
  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
            <SlidersHorizontal className="size-4" />
          </span>
          {t("title")}
        </h2>
        {stale ? <CardDescription className="text-[13px]">{t("staleNote")}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="flex flex-wrap gap-1.5" aria-label={t("title")}>
          {chips.map((c, i) => (
            <li key={`${c.key}-${i}`} className="inline-flex min-h-7 items-center rounded-full bg-muted px-3 py-1 text-xs font-medium">
              {label(c)}
            </li>
          ))}
        </ul>
        <Link href={`/plan/${analysisId}/anket`} onClick={() => track("plan_basis_edit_clicked")} className="-mx-1 inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-semibold text-brand hover:underline">
          <Pencil aria-hidden="true" className="size-4" />
          {t("edit")}
        </Link>
      </CardContent>
    </Card>
  );
}
