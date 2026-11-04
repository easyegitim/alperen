"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HAIR_LOSS_SPECIALTIES } from "@/content/expert-specialties";

type Props = { signal: "possible" | "visible"; doctorLayerEnabled: boolean; expertNetworkEnabled: boolean; hasScalpStep: boolean };

/**
 * Saç dökülmesi akışı (KB §6.3, R1-W2): tespit → nötr bilgi kartı → doktor katmanı (flag) → uzman dizini. Teşhis yok, ilaç
 * adı yok; "karar muayenede hekimindir". Bilgi kartı metni tr.json'da (safety ile aynı ton).
 */
export function HairLossCard({ signal, doctorLayerEnabled, expertNetworkEnabled, hasScalpStep }: Props) {
  const t = useTranslations("plan.v2.hairLoss");
  return (
    <section className="flex gap-3 rounded-2xl border border-dashed p-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
        <Info className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <h2 className="text-[15px] font-semibold">{t("title")}</h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{t(signal === "visible" ? "bodyVisible" : "bodyPossible")}</p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{t(hasScalpStep ? "info" : "infoGeneral")}</p>
        {doctorLayerEnabled ? (
          <a href="#section-doctor" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand hover:underline">
            {t("doctor")}
          </a>
        ) : null}
        {expertNetworkEnabled ? (
          <Button asChild variant="outline" className="w-full">
            <Link href={`/uzman?alan=${HAIR_LOSS_SPECIALTIES[0]}`}>{t("expert")}</Link>
          </Button>
        ) : null}
        <p className="text-[11px] text-muted-foreground">{t("notMedical")}</p>
      </div>
    </section>
  );
}
