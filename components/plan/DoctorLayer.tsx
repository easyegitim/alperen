"use client";

import { Stethoscope } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BodyImageScreen } from "@/components/plan/BodyImageScreen";
import { StepCard } from "@/components/plan/StepCard";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { BodyImageScreenResult } from "@/lib/config/plan";
import type { PlanViewV2 } from "@/lib/coach/planTypes";

type Props = { doctor: PlanViewV2["doctor"]; expertNetworkEnabled: boolean };

/**
 * Doktor katmanı (KB Ç3/Ç5; AUP): yalnız hekim onaylı öğeler (sunucu süzer); her öğede YZ açıklaması ve "Tıbbi tavsiye değildir".
 * off → tek satır; under_18 → gösterilmez; screen_required → tarama; screen_risk → uzmanla konuşma; pending → bekliyor.
 */
export function DoctorLayer({ doctor, expertNetworkEnabled }: Props) {
  const t = useTranslations("doctor");
  const [state, setState] = useState(doctor.state);
  if (state === "off" || state === "under_18") return null;
  const onResult = (r: BodyImageScreenResult) => setState(r === "risk" ? "screen_risk" : "pending_review");
  return (
    <Card id="section-doctor" className="scroll-mt-32">
      <CardHeader>
        <p className="eyebrow">{t("eyebrow")}</p>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
            <Stethoscope className="size-4" />
          </span>
          {t("title")}
        </h2>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === "screen_required" || state === "screen_risk" ? (
          <BodyImageScreen onResult={onResult} expertNetworkEnabled={expertNetworkEnabled} />
        ) : state === "pending_review" ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{t("pending")}</p>
        ) : state === "none" ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{t("none")}</p>
        ) : (
          <>
            <p className="rounded-xl bg-muted/60 p-3 text-[12px] leading-relaxed text-muted-foreground">{t("disclosure")}</p>
            <div className="space-y-2">
              {doctor.steps.map((s, i) => (
                <StepCard key={s.id} step={s} index={i} id={`step-${s.id}`} />
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{t("noDoseNote")}</p>
            <p className="text-[11px] text-muted-foreground">{t("notMedicalAdvice")}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
