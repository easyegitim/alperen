"use client";

import { Droplets, Scissors, Smile, Sparkles, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { GLOW_UP_LAYERS, type GlowUpLayer } from "@/lib/tryon/types";
import { cn } from "@/lib/utils";
import type { PlanStepLite } from "./stepTitles";

type Props = {
  layers: readonly GlowUpLayer[];
  onChange: (layers: GlowUpLayer[]) => void;
  onRun: () => void;
  /** Plandan gelen adımlar (W4 plan_v2). Boşsa glow-up çalışmaz: önce plan açılır (KB §7.2: görsel plana bağlı). */
  planSteps: readonly PlanStepLite[];
  /** Glow-up bağı: en son tamamlanmış analiz; yoksa önce analiz gerekir. */
  analysisId: string | null;
  disabled?: boolean;
};

const LAYER_ICON: Record<GlowUpLayer, LucideIcon> = { hair: Scissors, beard: Smile, skin: Droplets };
const LAYER_AREAS: Record<GlowUpLayer, readonly string[]> = { hair: ["hair", "color"], beard: ["beard"], skin: ["skin", "habit"] };

/** "İyileşmiş halin" (KB §7.2; PLAN 5d): adım anahtarları yalnız saç · yalnız sakal · cilt · hepsi; doktor işlemleri yok. */
export function GlowUpPanel({ layers, onChange, onRun, planSteps, analysisId, disabled }: Props) {
  const t = useTranslations("tryon.v2.glowUp");
  const hasAnalysis = Boolean(analysisId);
  const hasPlan = planSteps.length > 0;
  const all = layers.length === GLOW_UP_LAYERS.length;
  const toggle = (l: GlowUpLayer, on: boolean) => onChange(on ? [...new Set([...layers, l])] : layers.filter((x) => x !== l));
  const visibleSteps = planSteps.filter((s) => layers.some((l) => LAYER_AREAS[l].includes(s.area)));
  return (
    <Card className="bg-hero-glow">
      <CardHeader>
        <span aria-hidden="true" className="mb-1 grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
          <Sparkles className="size-6" />
        </span>
        <CardTitle className="text-xl font-bold">{t("title")}</CardTitle>
        <CardDescription className="text-[13px]">{t("intro")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasAnalysis ? <p role="alert" className="rounded-2xl border border-dashed p-3 text-[13px]">{t("needsAnalysis")}</p> : null}
        <fieldset className="space-y-2">
          <legend className="eyebrow mb-2">{t("layersTitle")}</legend>
          <label className={cn("flex min-h-11 items-center justify-between gap-3 rounded-2xl border bg-card px-3.5 py-2.5 shadow-card", all && "border-brand-gradient")}>
            <span className="flex items-center gap-2 text-[14px] font-semibold">
              <Sparkles aria-hidden="true" className="size-4 text-brand" /> {t("layers.all")}
            </span>
            <Switch checked={all} disabled={disabled} onCheckedChange={(on) => onChange(on ? [...GLOW_UP_LAYERS] : [])} aria-label={t("layers.all")} />
          </label>
          {GLOW_UP_LAYERS.map((l) => {
            const Icon = LAYER_ICON[l];
            const on = layers.includes(l);
            return (
              <label key={l} className={cn("flex min-h-11 items-center justify-between gap-3 rounded-2xl border bg-card px-3.5 py-2.5 shadow-card", on && "bg-brand-soft/40")}>
                <span className="flex items-center gap-2 text-[14px]">
                  <Icon aria-hidden="true" className="size-4 text-brand" /> {t(`layers.${l}`)}
                </span>
                <Switch checked={on} disabled={disabled} onCheckedChange={(v) => toggle(l, v)} aria-label={t(`layers.${l}`)} />
              </label>
            );
          })}
        </fieldset>
        <div className="space-y-1.5">
          <p className="eyebrow">{t("stepsTitle")}</p>
          {!hasPlan ? (
            <div className="space-y-2 rounded-2xl border border-dashed p-3">
              <p role={hasAnalysis ? "alert" : undefined} className="text-[13px] leading-relaxed text-muted-foreground">{t("planRequired")}</p>
              {analysisId ? (
                <Button asChild variant="outline" size="sm" className="h-11 rounded-xl">
                  <Link href={`/plan/${analysisId}`}>{t("planOpen")}</Link>
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {visibleSteps.map((s) => (
                <li key={s.id} className="rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium">{s.title}</li>
              ))}
              {visibleSteps.length === 0 ? <li className="text-[12px] text-muted-foreground">{t("noLayer")}</li> : null}
            </ul>
          )}
        </div>
        <ul className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
          <li>{t("skinNote")}</li>
          <li>{t("noDoctor")}</li>
          <li>{t("regenPaid")} {t("notForAds")}</li>
        </ul>
        <Button size="lg" className="w-full" onClick={onRun} disabled={disabled || !hasAnalysis || !hasPlan || layers.length === 0}>{t("run")}</Button>
      </CardContent>
    </Card>
  );
}
