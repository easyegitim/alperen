import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ArrowUpRight, Check } from "lucide-react";
import Link from "next/link";
import { PricingCards } from "@/components/marketing/PricingCards";

const INCLUDES = ["i1", "i2", "i3", "i4", "i5", "i6"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pricing");
  return { title: t("title") };
}

export default async function PricingPage() {
  const [t, tm] = await Promise.all([getTranslations("pricing"), getTranslations("method")]);
  return (
    <div className="relative overflow-x-clip">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-hero-glow" aria-hidden="true" />
      <div className="mx-auto w-full max-w-5xl space-y-10 px-4 pt-8 pb-14">
        <header className="space-y-2">
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-[13px] text-muted-foreground">{t("subtitle")}</p>
        </header>
        <PricingCards withCta />
        <section className="space-y-4" aria-labelledby="includes">
          <h2 id="includes" className="text-lg font-semibold tracking-tight">
            {t("includesTitle")}
          </h2>
          <ul className="space-y-1 rounded-2xl border bg-card p-2 shadow-card sm:grid sm:grid-cols-2 sm:gap-1 sm:space-y-0">
            {INCLUDES.map((k) => (
              <li key={k} className="flex items-start gap-3 rounded-xl px-3 py-2.5 text-sm">
                <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-brand" aria-hidden="true">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                {t(`includes.${k}`)}
              </li>
            ))}
          </ul>
          <Link
            href="/yontem?from=pricing"
            className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand underline-offset-4 hover:underline"
          >
            {tm("footerLink")}
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
          <div className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
            <p>{t("freeNote")}</p>
            <p>{t("autoRenewNote")}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
