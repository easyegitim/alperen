"use client";

import { Droplets, Dumbbell, ListChecks, Lock, Scissors, Shirt, Sparkles, UserRound, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePaywall } from "@/components/paywall/PaywallSheet";
import { LockedFeature } from "@/components/app/LockedFeature";
import type { PlanSkips } from "@/lib/coach/planBasis";

const SECTIONS = ["summary", "hair", "beard", "skin", "exercises", "habits", "style"] as const;

const ICON: Record<(typeof SECTIONS)[number], LucideIcon> = {
  summary: Sparkles,
  hair: Scissors,
  beard: UserRound,
  skin: Droplets,
  exercises: Dumbbell,
  habits: ListChecks,
  style: Shirt,
};

/** Kilitli satırdaki süs çubuğunun sabit genişlikleri: gerçek içerikten türetilmez. */
const PLACEHOLDER_WIDTHS = ["64%", "48%", "56%", "40%", "60%", "44%", "52%"] as const;

/**
 * Ücretsiz kullanıcıda plan sayfası (UI spec §7): bölüm adları kilitli satırlar olarak görünür, içerik yok.
 * Ankete göre eklenmeyecek bölümler (başörtüsü → saç, çene sağlığı → egzersiz, sakal yok) listelenmez.
 */
export function PlanLocked({ skipped = {} }: { skipped?: PlanSkips }) {
  const t = useTranslations("report");
  const ta = useTranslations("analysis");
  const { open } = usePaywall();
  const visible = SECTIONS.filter((s) => !(s === "hair" && skipped.hair) && !(s === "beard" && skipped.beard) && !(s === "exercises" && skipped.exercises));

  return (
    <LockedFeature title={t("lockedTitle")} body={t("lockedBody")} onUnlock={() => open("plan_page")}>
      <ul className="space-y-1.5">
        {visible.map((s, i) => {
          const name = t(`sections.${s}`);
          const Icon = ICON[s];
          return (
            <li key={s}>
              <button
                type="button"
                onClick={() => open("plan_page")}
                aria-label={ta("lockedAriaFor", { name })}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-accent"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 space-y-1.5" aria-hidden="true">
                  <span className="block text-sm font-semibold">{name}</span>
                  <span className="block h-1.5 rounded-full bg-muted-foreground/25 blur-[1.5px]" style={{ width: PLACEHOLDER_WIDTHS[i % PLACEHOLDER_WIDTHS.length] }} />
                </span>
                <Lock aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          );
        })}
      </ul>
    </LockedFeature>
  );
}
