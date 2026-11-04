"use client";

import { ArrowUpRight, Lock, Maximize2, ScanFace } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { GeometryOverlay, type OverlayLayerKey, type OverlaySource } from "@/components/analysis/GeometryOverlay";
import { LandmarkPortrait } from "@/components/analysis/LandmarkPortrait";
import { LockedValue, fmtScore } from "@/components/analysis/LockedValue";
import { OverlayDialog } from "@/components/analysis/OverlayDialog";
import { ReferenceScale } from "@/components/analysis/ReferenceScale";
import { ScoreRing } from "@/components/analysis/ScoreRing";
import { Card } from "@/components/ui/card";
import { track } from "@/lib/analytics";
import type { PaywallTrigger } from "@/lib/config/paywall";
import { CALIBRATION_REFERENCE } from "@/lib/config/scoring";
import type { ClientAnalysis } from "@/lib/score/present";
import { cn } from "@/lib/utils";

/** Açılış zamanlaması (UI spec §2.8): çizgiler 6 × 150 ms, sonra 700 ms sayaç, sonra çip. */
export const REVEAL_LINES_MS = 900;
export const REVEAL_COUNT_MS = 700;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Açık genel skorun 0'dan sayarak görünmesi (yalnız gösterim; ekran okuyucu son değeri okur). */
function useCountUp(target: number | null, run: boolean): number | null {
  const [shown, setShown] = useState<number | null>(run && target !== null ? 0 : target);
  useEffect(() => {
    if (!run || target === null || reducedMotion()) {
      const id = requestAnimationFrame(() => setShown(target));
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    const startAt = performance.now() + REVEAL_LINES_MS;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - startAt) / REVEAL_COUNT_MS));
      setShown(Math.round(target * (1 - (1 - p) ** 3) * 10) / 10);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return shown;
}

export function ScoreHero({
  a,
  onLocked,
  reveal,
  showLegacyNote,
  source,
  notMeasured,
}: {
  a: ClientAnalysis;
  onLocked: (t: PaywallTrigger) => void;
  reveal: boolean;
  showLegacyNote: boolean;
  /** Bu analize bağlı bellekteki selfie; yoksa şematik yüz. */
  source: OverlaySource | null;
  notMeasured: OverlayLayerKey[];
}) {
  const t = useTranslations("analysis");
  const tg = useTranslations("geometry");
  const [overlayOpen, setOverlayOpen] = useState(false);

  const overall = a.overall.locked ? null : a.overall.value;
  const shown = useCountUp(overall, reveal);
  const potential = a.potential.locked ? null : a.potential.value;
  const delta = a.potentialDelta.locked ? null : a.potentialDelta.value;
  const chipDelay = reveal ? { animationDelay: `${REVEAL_LINES_MS + REVEAL_COUNT_MS}ms` } : undefined;

  function openOverlay() {
    setOverlayOpen(true);
    track("overlay_opened", { source: source ? "photo" : "schematic" });
  }

  const chipClass = cn(
    "border-brand-gradient inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold",
    reveal && "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:fill-mode-both motion-safe:duration-300",
  );
  let chip: ReactNode = null;
  if (a.potential.locked) {
    // DOM'da /potansiyel|kilidi aç|premium/i ile eşleşen ilk düğme budur (e2e).
    chip = (
      <button
        type="button"
        onClick={() => onLocked("score_potential")}
        aria-label={t("lockedAriaFor", { name: t("hero.potentialLockedName") })}
        className={cn(chipClass, "transition-transform hover:scale-[1.02]")}
        style={chipDelay}
      >
        <ArrowUpRight className="size-4 text-brand" aria-hidden="true" />
        <span aria-hidden="true" className="num">
          {t("hero.potentialLocked")}
        </span>
        <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </button>
    );
  } else if (potential !== null) {
    chip = (
      <p className={chipClass} style={chipDelay}>
        <ArrowUpRight className="size-4 text-brand" aria-hidden="true" />
        <span className="num">
          {delta !== null && delta < 0.1
            ? t("hero.potentialAtTop")
            : t("hero.potentialOpen", { potential: fmtScore(potential), delta: fmtScore(delta ?? 0) })}
        </span>
      </p>
    );
  }

  return (
    <section aria-labelledby="hero-title">
      <Card className="bg-hero-glow gap-0 overflow-hidden pt-6 pb-0">
        <div className="flex flex-col items-center gap-4 px-5">
          <h2 id="hero-title" className="eyebrow">
            {t("overallTitle")}
          </h2>
          {showLegacyNote ? <p className="-mt-2 text-center text-xs text-muted-foreground">{t("legacyNote")}</p> : null}
          <ScoreRing value={overall} animate={reveal}>
            {a.overall.locked ? (
              <LockedValue
                v={a.overall}
                big
                pop={reveal}
                onTap={() => onLocked("score_main")}
                aria={t("lockedAriaFor", { name: t("overallTitle") })}
              />
            ) : (
              <p className="flex flex-col items-center">
                <span className="num text-display text-brand-gradient pr-[0.04em]" aria-hidden="true">
                  {shown === null ? "–" : fmtScore(shown)}
                </span>
                <span className="sr-only">{overall === null ? "–" : fmtScore(overall)}</span>
                <span className="num mt-1 text-sm font-medium text-muted-foreground">{t("hero.outOf")}</span>
              </p>
            )}
          </ScoreRing>
          {chip ? (
            <div className="flex flex-col items-center gap-1.5">
              {chip}
              <p className="text-xs text-muted-foreground">{t("hero.potentialCaption")}</p>
            </div>
          ) : null}
          <ReferenceScale reference={CALIBRATION_REFERENCE} value={overall} className="w-full" />
        </div>
        <div className="mt-5 flex items-center gap-4 border-t bg-muted/40 px-5 py-4">
          <button
            type="button"
            onClick={openOverlay}
            aria-label={t("overlay.open")}
            className="relative shrink-0 rounded-xl ring-1 ring-border transition-transform hover:scale-[1.02] [&>div>div]:h-[90px] [&>div>div]:w-[72px] [&>div>div]:rounded-xl"
          >
            <GeometryOverlay source={source} variant="thumb" animate={reveal} notMeasured={notMeasured} />
            <span className="absolute right-1 bottom-1 grid size-5 place-items-center rounded-md bg-background/80 backdrop-blur" aria-hidden="true">
              <Maximize2 className="size-3" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{tg("faceShape")}</p>
            <p className="text-xl font-semibold tracking-tight">{a.faceShape ? tg(`shapes.${a.faceShape}`) : "–"}</p>
            {a.faceShapeDetail?.secondary ? (
              <p className="text-sm text-muted-foreground">{tg("between", { other: tg(`shapes.${a.faceShapeDetail.secondary}`) })}</p>
            ) : null}
          </div>
        </div>
      </Card>
      <OverlayDialog open={overlayOpen} onOpenChange={setOverlayOpen} source={source} notMeasured={notMeasured} />
    </section>
  );
}

// ─── v2 kilitli hero (KB §3.3: P#6, P#7, P#8, P#9) ──────────────────────────────────────────────────────────────────

/**
 * Ödeme öncesi: yuvarlak portre (noktalı) üstte; genel skor halkası herkeste aynı süs yayı + kilit (skoru ele vermez);
 * potansiyel kilitli; yüz şekli ön değerlendirmesi (cihaz sonucu) açık ve en yakın ikinci şekille.
 */
export function ScoreHeroLocked({
  faceShape,
  source,
  onLocked,
}: {
  faceShape: { primary: string; secondary?: string } | null;
  source: OverlaySource | null;
  onLocked: (t: PaywallTrigger) => void;
}) {
  const t = useTranslations("analysis");
  const tg = useTranslations("geometry");
  return (
    <section aria-labelledby="hero-title">
      <Card className="bg-hero-glow gap-0 overflow-hidden pt-6 pb-0">
        <div className="flex flex-col items-center gap-4 px-5">
          <LandmarkPortrait source={source} />
          <h2 id="hero-title" className="eyebrow">
            {t("overallTitle")}
          </h2>
          <ScoreRing value={null} size={176}>
            <LockedValue v={{ value: null, locked: true }} big onTap={() => onLocked("score_main")} aria={t("locked.ringAria")} />
          </ScoreRing>
          <div className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              onClick={() => onLocked("score_potential")}
              aria-label={t("lockedAriaFor", { name: t("hero.potentialLockedName") })}
              className="border-brand-gradient inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-transform hover:scale-[1.02]"
            >
              <ArrowUpRight className="size-4 text-brand" aria-hidden="true" />
              <span aria-hidden="true" className="num">
                {t("hero.potentialLocked")}
              </span>
              <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </button>
            <p className="text-xs text-muted-foreground">{t("hero.potentialCaption")}</p>
          </div>
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">{t("scoreNote")}</p>
        </div>
        <div className="mt-5 flex items-center gap-4 border-t bg-muted/40 px-5 py-4">
          <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <ScanFace className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">{t("locked.faceShapePrelim")}</p>
            <p className="text-xl font-semibold tracking-tight">{faceShape ? tg(`shapes.${faceShape.primary}`) : "–"}</p>
            {faceShape?.secondary ? <p className="text-sm text-muted-foreground">{tg("nearTo", { other: tg(`shapes.${faceShape.secondary}`) })}</p> : null}
          </div>
        </div>
      </Card>
    </section>
  );
}
