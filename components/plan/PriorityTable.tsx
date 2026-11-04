"use client";

import { useTranslations } from "next-intl";
import type { PriorityRow, StepCard } from "@/lib/coach/planTypes";

/** Öncelik tablosu (KB §6.1): en üstte en az emekle en çok fark; etki ve emek noktalarla (sayı yok). onJump: karta git ("Tümü" sekmesi). */
export function PriorityTable({ rows, steps, onJump }: { rows: PriorityRow[]; steps: StepCard[]; onJump?: (stepId: string) => void }) {
  const t = useTranslations("plan.v2.priority");
  const byId = new Map(steps.map((s) => [s.id, s]));
  const dots = (n: 1 | 2 | 3, label: string) => (
    <span className="inline-flex gap-0.5" role="img" aria-label={`${label}: ${n}/3`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? "size-2 rounded-full bg-brand-gradient" : "size-2 rounded-full bg-track"} />
      ))}
    </span>
  );
  return (
    <section className="space-y-2">
      <h3 className="eyebrow">{t("title")}</h3>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      <ol className="divide-y divide-border/60 rounded-xl bg-muted/60">
        {rows.map((r, i) => {
          const s = byId.get(r.stepId);
          if (!s) return null;
          return (
            <li key={r.stepId}>
              <a
                href={`#step-${r.stepId}`}
                onClick={onJump ? (e) => { e.preventDefault(); onJump(r.stepId); } : undefined}
                className="flex min-h-12 items-center gap-3 px-3 py-2 transition-colors hover:bg-accent"
              >
                <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-cta-gradient text-[11px] font-bold text-primary-foreground" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.title}</span>
                <span className="flex shrink-0 flex-col items-end gap-0.5 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">{t("impact")} {dots(r.impact, t("impact"))}</span>
                  <span className="inline-flex items-center gap-1">{t("effort")} {dots(r.effort, t("effort"))}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
