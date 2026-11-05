import { Camera, Gauge, ShieldCheck, Sparkles, TrendingUp, UserCheck, Scale } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Faq } from "@/components/marketing/Faq";
import { PricingCards } from "@/components/marketing/PricingCards";
import { SampleResultCard } from "@/components/marketing/SampleResultCard";
import { StartAnalysisButton } from "@/components/marketing/StartAnalysisButton";

const STEPS = [
  { key: "s1", Icon: Camera },
  { key: "s2", Icon: Gauge },
  { key: "s3", Icon: TrendingUp },
] as const;

const TRUST = [
  { key: "photo", Icon: ShieldCheck },
  { key: "adult", Icon: UserCheck },
  { key: "fair", Icon: Scale },
] as const;

/** Başlığın son cümleciği marka gradyanıyla; metin tek anahtardan gelir (mobil de aynı anahtarı düz kullanır). */
function splitTitle(title: string): [string, string] {
  const i = title.lastIndexOf(", ");
  return i > 0 ? [title.slice(0, i + 1), title.slice(i + 2)] : [title, ""];
}

export default async function LandingPage() {
  const t = await getTranslations();
  const [titleHead, titleTail] = splitTitle(t("landing.heroTitle"));
  return (
    <div className="relative overflow-x-clip">
      {/* Süs: üstte yumuşak marka parıltısı */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem] bg-hero-glow" aria-hidden="true" />

      <div className="mx-auto w-full max-w-5xl px-4">
        <section className="grid gap-10 pt-8 pb-12 md:grid-cols-2 md:items-center md:py-20">
          <div className="space-y-6">
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-brand-soft px-3 text-xs font-semibold text-brand">
              <Sparkles className="size-3.5" aria-hidden="true" />
              {t("landing.heroEyebrow")}
            </span>
            <h1 className="text-[2.5rem] leading-[1.05] font-bold tracking-tight sm:text-5xl md:text-6xl">
              {titleHead} {titleTail ? <span className="text-brand-gradient">{titleTail}</span> : null}
            </h1>
            <p className="max-w-md text-base text-muted-foreground sm:text-lg">{t("landing.heroSubtitle")}</p>
            <StartAnalysisButton size="lg" className="w-full sm:w-auto" />
            <ul className="flex flex-wrap gap-1.5" aria-label={t("landing.trustLabel")}>
              {TRUST.map(({ key, Icon }) => (
                <li key={key} className="inline-flex h-7 items-center gap-1 rounded-full border bg-card/60 px-2.5 text-[11px] font-medium text-muted-foreground">
                  <Icon className="size-3 text-brand" aria-hidden="true" />
                  {t(`landing.trust.${key}`)}
                </li>
              ))}
            </ul>
          </div>
          <SampleResultCard />
        </section>

        <section className="py-10" aria-labelledby="how">
          <p className="eyebrow">{t("landing.howEyebrow")}</p>
          <h2 id="how" className="mt-1 text-2xl font-bold tracking-tight">
            {t("landing.howTitle")}
          </h2>
          <ol className="mt-6 grid gap-3 sm:grid-cols-3">
            {STEPS.map(({ key, Icon }, i) => (
              <li key={key} className="flex gap-4 rounded-2xl border bg-card p-4 shadow-card sm:flex-col">
                <span className="relative grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand" aria-hidden="true">
                  <Icon className="size-5" />
                  <span className="num absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-cta-gradient text-[10px] font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                </span>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold">{t(`landing.steps.${key}.title`)}</h3>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{t(`landing.steps.${key}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="py-10" aria-labelledby="pricing">
          <p className="eyebrow">{t("landing.pricingEyebrow")}</p>
          <h2 id="pricing" className="mt-1 text-2xl font-bold tracking-tight">
            {t("landing.pricingTitle")}
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{t("landing.pricingSubtitle")}</p>
          <div className="mt-6">
            <PricingCards />
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">{t("pricing.freeNote")}</p>
        </section>

        <section className="py-10" aria-labelledby="faq">
          <p className="eyebrow">{t("landing.faqEyebrow")}</p>
          <h2 id="faq" className="mt-1 text-2xl font-bold tracking-tight">
            {t("landing.faqTitle")}
          </h2>
          <div className="mt-6">
            <Faq />
          </div>
        </section>

        <section className="pt-4 pb-16">
          <div className="border-brand-gradient relative overflow-hidden rounded-3xl px-6 py-10 text-center shadow-card">
            <div className="pointer-events-none absolute inset-0 bg-hero-glow" aria-hidden="true" />
            <div className="relative space-y-2">
              <span className="mx-auto mb-3 block size-10 rounded-full bg-brand-gradient shadow-glow" aria-hidden="true" />
              <h2 className="text-2xl font-bold tracking-tight">{t("landing.ctaFinalTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("landing.ctaFinalBody")}</p>
              <div className="pt-4">
                <StartAnalysisButton size="lg" className="w-full sm:w-auto" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
