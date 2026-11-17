import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** v2 sırası (KB §3.1): yaş → cinsiyet → hesap → izinler → fotoğraflar. Yalnız görsel yönlendirme; erişim kontrolü sunucuda. */
const STEPS = ["age", "gender", "account", "consents"] as const;
export type OnboardingStep = (typeof STEPS)[number];

export function OnboardingSteps({ current }: { current: OnboardingStep }) {
  const t = useTranslations("onboarding.flow");
  const index = STEPS.indexOf(current);
  return (
    <nav aria-label={t("label")} className="space-y-2">
      <ol className="grid grid-cols-4 gap-1.5">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === index ? "step" : undefined}>
            <span className={cn("block h-1 rounded-full", i <= index ? "bg-brand-gradient" : "bg-track")} aria-hidden="true" />
            <span className={cn("mt-1.5 block text-[11px] font-medium", i === index ? "text-foreground" : "text-muted-foreground")}>
              {t(s)}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
