"use client";

import { ChevronDown, Clock, ExternalLink, Scissors } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { BarberCard } from "@/components/plan/BarberCard";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { postJson } from "@/lib/api/client";
import type { StepCard as StepCardType } from "@/lib/coach/planTypes";
import { cn } from "@/lib/utils";

export type StepLink = { id: string; label: string; url: string; isAd: boolean; merchant: string | null };

type Props = { step: StepCardType; links?: StepLink[]; index?: number; id?: string };

const fmtTry = (n: number) => n.toLocaleString("tr-TR");

/** Adım kartı (KB §6.1): ne, hangi gözleme bağlı, ₺ aralığı, sıklık, dk/gün, zorluk, kanıt cümlesi + kaynak; "Dene" ve "Berbere göster". */
export function StepCard({ step, links = [], index = 0, id }: Props) {
  const t = useTranslations("plan.v2");
  const tr = useTranslations("report.v2.regions");
  const [open, setOpen] = useState(false);
  const cost = step.costTryRange.max === 0 && step.costTryRange.min === 0 ? t("step.costFree") : step.costTryRange.max === null ? t("step.costFrom", { min: fmtTry(step.costTryRange.min) }) : t("step.costRange", { min: fmtTry(step.costTryRange.min), max: fmtTry(step.costTryRange.max) });
  const freq = step.frequency.per === "once" ? t("step.frequency.once") : t(`step.frequency.${step.frequency.per}`, { n: step.frequency.times });
  const toggle = () => {
    if (!open) track("plan_step_opened");
    setOpen((o) => !o);
  };
  return (
    <article id={id} className="scroll-mt-32 space-y-2 rounded-xl border bg-muted/40 px-4 pt-3.5 pb-2 motion-safe:animate-fade-up" style={{ animationDelay: `${index * 40}ms` }}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">{t(`tiers.${step.tier}`)}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t(`phases.${step.phase}`)}</span>
          </div>
          <h3 className="text-[15px] font-semibold">{step.title}</h3>
          {step.summary ? <p className="text-[13px] leading-relaxed text-muted-foreground">{step.summary}</p> : null}
        </div>
        {step.tryonPresetId ? (
          <Button asChild variant="outline" size="sm" className="h-11 shrink-0 rounded-full px-3.5 text-brand">
            <Link href={`/dene?preset=${encodeURIComponent(step.tryonPresetId)}`}>
              <Scissors aria-hidden="true" /> {t("step.tryIt")}
            </Link>
          </Button>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        <Meta label={t("step.cost")} value={cost} />
        <Meta label={t("step.frequencyLabel")} value={freq} />
        <Meta label={t("step.minutesLabel")} value={t("step.minutes", { n: step.minutesPerDay })} icon={<Clock className="size-3" aria-hidden="true" />} />
        <Meta label={t("step.difficulty")} value={t(`step.level.${step.difficulty}`)} />
      </dl>
      <p className="text-[12px] text-muted-foreground">
        <span className="font-semibold text-foreground">{t("step.evidenceLabel")}:</span> {t(`evidence.${step.evidence.level}`)}
        {step.evidence.source ? (
          <>
            {" · "}
            <a href={step.evidence.source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-brand underline-offset-2 hover:underline">
              {t("step.source")}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </>
        ) : null}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <button type="button" onClick={toggle} aria-expanded={open} className="-mx-1 inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          {t("step.observation")}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
        {step.barberSpec ? <BarberCard spec={step.barberSpec} /> : null}
      </div>
      {open ? (
        <div className="space-y-2 pb-1 text-[13px] leading-relaxed text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground">{tr(step.observationRef.region)}:</span> {step.observationRef.observation ?? "—"}
          </p>
          {step.perceptionOnly ? <p className="text-xs">{t("step.perceptionNote")}</p> : null}
          {links.length ? (
            <ul className="space-y-1">
              {links.map((l) => (
                <li key={l.id}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    onClick={() => void postJson("/api/links/click", { linkId: l.id }).catch(() => undefined)}
                    className="inline-flex min-h-9 items-center gap-1.5 text-brand underline-offset-2 hover:underline"
                  >
                    {l.isAd ? <span className="rounded border px-1 text-[10px] font-semibold uppercase text-muted-foreground">{t("links.adLabel")}</span> : null}
                    {l.label}
                    {l.merchant ? <span className="text-muted-foreground">· {l.merchant}</span> : null}
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function Meta({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="inline-flex items-center gap-1 font-medium">
        {icon}
        {value}
      </dd>
    </div>
  );
}
