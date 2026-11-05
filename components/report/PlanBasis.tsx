"use client";

import { ChevronRight, Pencil, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { track } from "@/lib/analytics";
import { goalMatch, leverSection, type BasisChip, type Goal, type ReportSection } from "@/lib/coach/planBasis";
import { GOALS } from "@/lib/questionnaire";
import type { ImproveItem } from "@/lib/score/contract";

/** Çip anahtarı → questionnaire.options grubu (değer çevirisi için). */
const OPTION_GROUP: Partial<Record<BasisChip["key"], string>> = {
  goal: "goals",
  skinType: "skinType",
  budget: "budget",
  hairType: "hairType",
  beard: "beardPreference",
};

type Props = {
  analysisId: string;
  basis: BasisChip[];
  improveFirst: ImproveItem[] | null;
  /** Raporda gerçekten gösterilen bölümler: öncelik maddesi yalnız bunlara bağlanır. */
  rendered: ReadonlySet<ReportSection>;
  stale: boolean;
};

/** "Planın şunlara göre hazırlandı" (UI spec §7, F09): anket çipleri, öncelik sırası, hedef eşleşmesi, düzenleme bağlantısı. */
export function PlanBasis({ analysisId, basis, improveFirst, rendered, stale }: Props) {
  const t = useTranslations("report.basis");
  const tq = useTranslations("questionnaire.options");
  const ta = useTranslations("analysis.levers");

  const optionLabel = (group: string, value: string | number | undefined) => {
    const k = `${group}.${String(value)}`;
    return tq.has(k) ? tq(k) : String(value ?? "");
  };
  const chipLabel = (c: BasisChip) => {
    if (c.key === "minutes") return t("chip.minutes", { n: Number(c.values?.n ?? 0) });
    const group = OPTION_GROUP[c.key];
    return group ? t(`chip.${c.key}`, { value: optionLabel(group, c.values?.value) }) : t(`chip.${c.key}`);
  };

  const goals: Goal[] = basis.flatMap((c) => (c.key === "goal" ? GOALS.filter((g) => g === c.values?.value) : []));
  const items = improveFirst ?? [];
  const match = goalMatch(goals, items[0]);

  const title = stale ? t("titleCurrent") : t("title");
  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
            <SlidersHorizontal className="size-4" />
          </span>
          {title}
        </h2>
        {stale ? <CardDescription className="text-[13px]">{t("staleNote")}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="flex flex-wrap gap-1.5" aria-label={title}>
          {basis.map((c, i) => (
            <li key={`${c.key}-${i}`} className="inline-flex min-h-7 items-center rounded-full bg-muted px-3 py-1 text-xs font-medium">
              {chipLabel(c)}
            </li>
          ))}
        </ul>

        {items.length ? (
          <div className="space-y-2">
            <h3 className="eyebrow">{t("priorities")}</h3>
            <ol className="space-y-1.5">
              {items.map((it, i) => {
                const section = leverSection(it.lever);
                const label = ta.has(it.lever) ? ta(it.lever) : it.lever;
                const inner = (
                  <>
                    <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-cta-gradient text-[11px] font-bold text-primary-foreground" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
                  </>
                );
                return (
                  <li key={it.lever}>
                    {section && rendered.has(section) ? (
                      <a href={`#section-${section}`} className="flex min-h-12 items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2 transition-colors hover:bg-accent">
                        {inner}
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="flex min-h-12 items-center gap-3 rounded-xl bg-muted/40 px-3 py-2">{inner}</span>
                    )}
                  </li>
                );
              })}
            </ol>
            {match ? <p className="text-xs text-muted-foreground">{t("goalMatch", { goal: optionLabel("goals", match) })}</p> : null}
          </div>
        ) : null}

        <Link
          href={`/baslangic/anket?next=${encodeURIComponent(`/plan/${analysisId}`)}`}
          onClick={() => track("plan_basis_edit_clicked")}
          className="-mx-1 inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-semibold text-brand hover:underline"
        >
          <Pencil aria-hidden="true" className="size-4" />
          {t("edit")}
        </Link>
      </CardContent>
    </Card>
  );
}
