import { useTranslations } from "next-intl";
import { DEFAULT_PLAN_ID, PLANS, SUBSCRIPTION_PLAN_IDS, formatTry, weeklyEquivalentTry, type SubscriptionPlanId } from "@/lib/config/plans";
import { cn } from "@/lib/utils";
import { PLAN_BADGE_CLASS, PlanRibbon } from "@/components/billing/PlanOption";
import { StartAnalysisButton } from "./StartAnalysisButton";

const PERIOD_KEY: Record<SubscriptionPlanId, "perWeek" | "perMonth" | "perYear"> = {
  weekly: "perWeek",
  monthly: "perMonth",
  yearly: "perYear",
};

/** Plan kartları; fiyatlar lib/config/plans.ts'ten gelir (SPEC 5.1). Mobilde kompakt satır, genişte üç sütun. */
export function PricingCards({ withCta = false }: { withCta?: boolean }) {
  const t = useTranslations("pricing");
  const tw = useTranslations("paywall");
  return (
    <div className="space-y-4">
      <ul className="grid gap-3 sm:grid-cols-3">
        {SUBSCRIPTION_PLAN_IDS.map((id) => {
          const plan = PLANS[id];
          const highlighted = id === DEFAULT_PLAN_ID;
          const badge = id === "weekly" ? null : t(`plans.${id}.badge`);
          return (
            <li
              key={id}
              className={cn(
                "relative space-y-3 rounded-2xl p-4 shadow-card sm:p-5",
                highlighted && "mt-2.5 sm:mt-0",
                highlighted ? "border-brand-gradient shadow-glow" : "border bg-card",
              )}
            >
              {highlighted ? <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-hero-glow" aria-hidden="true" /> : null}
              {highlighted ? <PlanRibbon>{tw("bestValue")}</PlanRibbon> : null}
              <div className="relative flex min-h-6 items-center justify-between gap-2">
                <p className="text-[15px] font-semibold">{t(`plans.${id}.name`)}</p>
                {badge ? (
                  <span className={cn(PLAN_BADGE_CLASS, "truncate")}>{badge}</span>
                ) : null}
              </div>
              <div className="relative flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                <p className="whitespace-nowrap">
                  <span className={cn("num text-3xl font-bold", highlighted && "text-brand-gradient")}>{formatTry(plan.priceTry)}</span>
                  <span className="text-[13px] text-muted-foreground"> / {t(PERIOD_KEY[id])}</span>
                </p>
                {id === "weekly" ? null : (
                  <p className="num pb-1 text-xs text-muted-foreground">{t("weeklyEquivalent", { amount: formatTry(weeklyEquivalentTry(id)) })}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {withCta ? <StartAnalysisButton size="lg" className="w-full sm:w-auto" /> : null}
    </div>
  );
}
