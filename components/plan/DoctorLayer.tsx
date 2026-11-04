"use client";

import { Stethoscope } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BodyImageRiskNotice, BodyImageScreen } from "@/components/plan/BodyImageScreen";
import { StepCard } from "@/components/plan/StepCard";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { BodyImageScreenResult } from "@/lib/config/plan";
import type { PlanViewV2 } from "@/lib/coach/planTypes";

type Props = { doctor: PlanViewV2["doctor"]; expertNetworkEnabled: boolean; analysisId: string };

/**
 * Doktor katmanı (KB Ç3/Ç5; AUP): yalnız hekim onaylı öğeler (sunucu süzer); her öğede YZ açıklaması ve "Tıbbi tavsiye değildir".
 * off → tek satır; under_18 → gösterilmez; screen_required → tarama; screen_risk → uzmanla konuşma (yeniden yükleyince de,
 * tarama tekrar sorulmaz); pending → bekliyor. Tarama sonrası durum iyimser yazılmaz: sunucudan (GET /api/doctor) okunur.
 */
export function DoctorLayer({ doctor, expertNetworkEnabled, analysisId }: Props) {
  const t = useTranslations("doctor");
  const [state, setState] = useState(doctor.state);
  const [steps, setSteps] = useState(doctor.steps);
  if (state === "off" || state === "under_18") return null;
  const onResult = async (r: BodyImageScreenResult) => {
    if (r === "risk") {
      setState("screen_risk");
      return;
    }
    try {
      const res = await fetch(`/api/doctor?analysisId=${encodeURIComponent(analysisId)}`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as PlanViewV2["doctor"];
      setSteps(Array.isArray(data.steps) ? data.steps : []);
      setState(data.state ?? "none");
    } catch {
      setState("none");
    }
  };
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
        {state === "screen_required" ? (
          <BodyImageScreen onResult={(r) => void onResult(r)} expertNetworkEnabled={expertNetworkEnabled} analysisId={analysisId} />
        ) : state === "screen_risk" ? (
          <BodyImageRiskNotice expertNetworkEnabled={expertNetworkEnabled} />
        ) : state === "pending_review" ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{t("pending")}</p>
        ) : state === "none" ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{t("none")}</p>
        ) : (
          <>
            <p className="rounded-xl bg-muted/60 p-3 text-[12px] leading-relaxed text-muted-foreground">{t("disclosure")}</p>
            <div className="space-y-2">
              {steps.map((s, i) => (
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
