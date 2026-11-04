"use client";

import { ChevronsLeftRight, Flag, Share2, Shuffle } from "lucide-react";
import { useTranslations } from "next-intl";
import { FeedbackButtons } from "@/components/report/FeedbackButtons";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { QcVerdict, TryonMode } from "@/lib/tryon/types";
import { cn } from "@/lib/utils";

export type TryonResultView = {
  eventId: string;
  mode: TryonMode;
  title: string;
  beforeUrl: string;
  afterUrl: string;
  /** Göz hizası (0–1, görsel yüksekliğine oran): önce/sonra kaydırıcısında kılavuz çizgi (KB §7.2). */
  eyeLineY: number | null;
  appliedSteps: { id: string; title: string }[];
  qc: QcVerdict | null;
  regenCount: number;
};

type Props = {
  result: TryonResultView;
  slider: number;
  onSlider: (v: number) => void;
  onShare: () => void;
  onFlag: () => void;
  flagged: boolean;
  onBack: () => void;
  sharing?: boolean;
};

/** Deneme sonucu (PLAN 5d/5e): gözlere hizalı önce/sonra, uygulanan adımlar, paylaş (etiket gömülü), "Bozuk görünüyor". */
export function TryonResult({ result, slider, onSlider, onShare, onFlag, flagged, onBack, sharing }: Props) {
  const t = useTranslations("tryon");
  return (
    <div className="space-y-4">
      <BeforeAfter beforeUrl={result.beforeUrl} afterUrl={result.afterUrl} slider={slider} onSlider={onSlider} name={result.title} eyeLineY={result.eyeLineY} />
      {result.mode === "glow_up" ? (
        <section aria-label={t("v2.glowUp.applied")} className="rounded-2xl border bg-card p-3.5 shadow-card">
          <p className="eyebrow mb-2">{t("v2.glowUp.applied")}</p>
          <ul className="flex flex-wrap gap-1.5">
            {result.appliedSteps.map((s) => (
              <li key={s.id} className="rounded-full bg-brand-soft px-2.5 py-1 text-[12px] font-medium text-brand">{s.title}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t("v2.glowUp.skinNote")}</p>
        </section>
      ) : null}
      {result.qc ? (
        <p className="text-[11px] text-muted-foreground">
          {t("v2.result.qcPassed")}
          {result.regenCount > 0 ? ` · ${t("v2.result.qcRegen", { n: result.regenCount })}` : ""}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="lg" onClick={onShare} disabled={sharing}><Share2 aria-hidden="true" /> {t("v2.share")}</Button>
        <Button size="lg" onClick={onBack}><Shuffle aria-hidden="true" /> {t("v2.result.tryAnother")}</Button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <FeedbackButtons targetType="tryon" targetId={result.eventId} />
        <Button variant="ghost" size="sm" className="h-11 rounded-xl" onClick={onFlag} disabled={flagged} aria-label={t("v2.flagBrokenAria")} aria-pressed={flagged}>
          <Flag aria-hidden="true" className="size-4" /> {flagged ? t("v2.flagged") : t("v2.flagBroken")}
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("v2.faceKept")} {t("v2.result.labelBurned")} {t("resultNote")}
      </p>
    </div>
  );
}

/** Önce/sonra karşılaştırma (sunum). Görseller yalnız yerel blob URL'leri; göz hizası kılavuzu isteğe bağlı. */
export function BeforeAfter({ beforeUrl, afterUrl, slider, onSlider, name, eyeLineY = null }: { beforeUrl: string; afterUrl: string; slider: number; onSlider: (v: number) => void; name: string; eyeLineY?: number | null }) {
  const t = useTranslations("tryon");
  const tc = useTranslations("common");
  const pill = "absolute rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-md";
  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-3xl border bg-black shadow-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- yerel blob */}
        <img src={afterUrl} alt={t("afterAlt")} className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${slider}%` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- yerel blob */}
          <img src={beforeUrl} alt={t("beforeAlt")} className="size-full max-w-none object-cover" style={{ width: `${10000 / Math.max(slider, 1)}%` }} />
        </div>
        {eyeLineY !== null ? (
          <div aria-hidden="true" className="absolute inset-x-0 border-t border-dashed border-white/60" style={{ top: `${eyeLineY * 100}%` }}>
            <span className="absolute right-2 -top-4 rounded-full bg-black/45 px-1.5 text-[9px] text-white/90">{t("v2.glowUp.eyeLine")}</span>
          </div>
        ) : null}
        <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/90" style={{ left: `${slider}%` }} aria-hidden="true">
          <span className="absolute top-1/2 left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black shadow-lg">
            <ChevronsLeftRight className="size-4" />
          </span>
        </div>
        <span className={cn(pill, "top-3 left-3")}>{t("before")}</span>
        <span className={cn(pill, "top-3 right-3")}>{t("after")}</span>
        <span className={cn(pill, "right-3 bottom-3 font-medium")}>{tc("aiGenerated")}</span>
      </div>
      <Slider value={[slider]} onValueChange={(v) => onSlider(v[0] ?? 50)} min={0} max={100} step={1} aria-label={eyeLineY !== null ? t("v2.glowUp.sliderEyes") : t("sliderAria")} className="py-2" />
      <div className="text-center">
        <p className="text-lg font-semibold tracking-tight">{name}</p>
        <p className="text-[11px] text-muted-foreground">{t("sliderHint")}</p>
      </div>
    </div>
  );
}
