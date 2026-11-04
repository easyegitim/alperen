"use client";

import { useTranslations } from "next-intl";
import { PLAN_PHASES } from "@/lib/config/plan";
import type { PlanV2, StepCard } from "@/lib/coach/planTypes";

/** Fazlar (KB §6.1): 0–4 hafta · 1–3 ay · 3–6 ay; her fazda adım adları (kartlara bağlantı). */
export function PlanPhases({ phases, steps }: { phases: PlanV2["phases"]; steps: StepCard[] }) {
  const t = useTranslations("plan.v2");
  const byId = new Map(steps.map((s) => [s.id, s]));
  return (
    <section className="space-y-2">
      <h3 className="eyebrow">{t("phasesTitle")}</h3>
      <ol className="grid gap-2">
        {PLAN_PHASES.map((ph, i) => (
          <li key={ph} className="rounded-xl border bg-card p-3 shadow-card">
            <div className="flex items-center gap-2">
              <span className="num grid size-6 place-items-center rounded-full bg-brand-soft text-[11px] font-bold text-brand" aria-hidden="true">
                {i + 1}
              </span>
              <h4 className="text-sm font-semibold">{t(`phases.${ph}`)}</h4>
              <span className="ml-auto text-[11px] text-muted-foreground">{t("stepCount", { n: phases[ph].length })}</span>
            </div>
            {phases[ph].length ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {phases[ph].map((id) => (
                  <li key={id}>
                    <a href={`#step-${id}`} className="inline-flex min-h-8 items-center rounded-full bg-muted px-3 text-xs font-medium hover:bg-accent">
                      {byId.get(id)?.title ?? id}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">{t("emptyPhase")}</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
