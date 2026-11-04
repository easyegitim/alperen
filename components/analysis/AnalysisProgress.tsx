"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { GeometryOverlay, type OverlaySource } from "@/components/analysis/GeometryOverlay";
import { PROGRESS_STAGES, progressValue, type ProgressStage, type ProgressState } from "@/lib/analysis/progressModel";
import { DEVICE_STEPS, deviceProgressValue, type DeviceProgress, type DeviceStep } from "@/lib/face/deviceProgress";
import { faceCrop } from "@/lib/face/overlay";
import type { EngineName } from "@/lib/score/contract";
import { cn } from "@/lib/utils";

const SLOW_AFTER_MS = 30_000;
const TICK_MS = 250;

/**
 * Adımlı analiz ilerlemesi (UI spec §3, SPEC 4.1 adım 7, yalnız web; eski motorlar). Adımlar gerçek işe bağlıdır: ilk ikisi
 * gönderimden önce bitmiştir, "hazırlık" kırpım bitince, "gözlem" yanıt gelince, "skor" yanıttan hemen sonra tamamlanır.
 */
export function AnalysisProgress({ state, engine, source }: { state: ProgressState; engine: EngineName; source: OverlaySource | null }) {
  const t = useTranslations("analysis.progress.v2");
  const [now, setNow] = useState(() => state.startedAt);

  useEffect(() => {
    if (state.finished) return;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [state.finished]);

  const label = (s: ProgressStage) => (s === "observe" ? t(engine === "hybrid.v1" ? "observe" : "observeLegacy") : t(s));
  const value = Math.round(progressValue(state, now));
  // Canlı bölge yalnız adım değişince duyurur (her tikte değil).
  const announcement = state.finished ? t("ready") : state.active ? label(state.active) : "";

  return (
    <div className="space-y-5 py-2">
      <div className="space-y-1 text-center">
        <p className="eyebrow">{state.finished ? t("ready") : t("title")}</p>
        <p className="num text-5xl leading-none font-bold text-brand-gradient" aria-hidden="true">
          {value}
          <span className="text-2xl">%</span>
        </p>
      </div>
      <GeometryOverlay source={source} variant="scan" />
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <div aria-hidden="true" className="mx-auto h-2 max-w-[280px] overflow-hidden rounded-full bg-track">
        <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-300 ease-out" style={{ width: `${value}%` }} />
      </div>
      <StepList<ProgressStage> steps={PROGRESS_STAGES} done={state.done} active={state.active} label={label} doneSr={t("doneSr")} />
      <p className="text-center text-[11px] text-muted-foreground">{t("hint")}</p>
      {!state.finished && now - state.startedAt > SLOW_AFTER_MS ? <p className="text-center text-xs">{t("slow")}</p> : null}
    </div>
  );
}

/**
 * v2 ödeme öncesi yükleme ekranı (KB P#5, PLAN 1e): üstte kullanıcının fotoğrafı, yeşil tarama çubuğu aşağı yukarı gezer,
 * adımlar gerçek cihaz işleri, son satır "Analizin tamamlandı". prefers-reduced-motion'da çubuk sabit durur.
 */
export function DeviceAnalysisProgress({ state, source, viewsCount }: { state: DeviceProgress; source: OverlaySource | null; viewsCount: number }) {
  const t = useTranslations("analysis.deviceProgress");
  const value = deviceProgressValue(state);
  const label = (s: DeviceStep) => (s === "views" ? t("views", { count: viewsCount }) : t(s));
  const announcement = state.finished ? t("done") : state.active ? label(state.active) : "";
  return (
    <div className="space-y-5 py-2">
      <div className="space-y-1 text-center">
        <p className="eyebrow">{state.finished ? t("done") : t("title")}</p>
        <p className="num text-5xl leading-none font-bold text-brand-gradient" aria-hidden="true">
          {value}
          <span className="text-2xl">%</span>
        </p>
      </div>
      <ScanPhoto source={source} active={!state.finished} />
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <div aria-hidden="true" className="mx-auto h-2 max-w-[280px] overflow-hidden rounded-full bg-track">
        <div className="h-full rounded-full bg-brand-gradient transition-[width] duration-300 ease-out" style={{ width: `${value}%` }} />
      </div>
      <StepList<DeviceStep> steps={DEVICE_STEPS} done={state.done} active={state.active} label={label} doneSr={t("doneSr")} />
      {state.finished ? (
        <p className="text-center text-base font-semibold" role="status">
          {t("done")}
        </p>
      ) : (
        <p className="text-center text-[11px] text-muted-foreground">{t("hint")}</p>
      )}
    </div>
  );
}

function StepList<S extends string>({ steps, done, active, label, doneSr }: { steps: readonly S[]; done: readonly S[]; active: S | null; label: (s: S) => string; doneSr: string }) {
  return (
    <ol className="mx-auto max-w-sm space-y-1.5 text-sm">
      {steps.map((s) => {
        const isDone = done.includes(s);
        const isActive = active === s;
        return (
          <li
            key={s}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 transition-colors",
              isActive && "bg-brand-soft font-semibold",
              !isDone && !isActive && "text-muted-foreground",
            )}
            aria-current={isActive ? "step" : undefined}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full",
                isDone && "bg-cta-gradient text-primary-foreground",
                isActive && "text-brand",
                !isDone && !isActive && "bg-muted",
              )}
            >
              {isDone ? <Check className="size-3.5" strokeWidth={3} /> : isActive ? <LoaderCircle className="size-5 motion-safe:animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
            </span>
            <span className="leading-snug">
              {label(s)}
              {isDone ? <span className="sr-only"> {doneSr}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Kullanıcının fotoğrafı (yüz kırpımı, 4:5) ve üzerinde aşağı yukarı gezen yeşil tarama çubuğu (KB P#5). Yalnız bellekteki
 * bitmap tuvale çizilir; toDataURL/indirme yok. Fotoğraf yoksa (sayfa yenilendi) şematik yüz yerine boş kart gösterilmez,
 * yalnız çubuk alanı kalır.
 */
function ScanPhoto({ source, active }: { source: OverlaySource | null; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const usable = source !== null && source.bitmap.width > 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source || !usable) return;
    const crop = faceCrop(source.landmarks, source.width, source.height, 0.3, 0.8);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(Math.min(crop.width, 280 * dpr)));
    const h = Math.max(1, Math.round(w / 0.8));
    const raf = requestAnimationFrame(() => {
      try {
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")?.drawImage(source.bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);
      } catch {
        // kapanmış bitmap: çubuk alanı boş kalır
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      canvas.width = 0;
    };
  }, [source, usable]);

  // Tarama çubuğu: React state'i değil, doğrudan transform (her karede render yok); azaltılmış harekette sabit.
  useEffect(() => {
    const el = barRef.current;
    if (!el || !active || prefersReducedMotion()) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const phase = ((now - start) / 2200) % 2;
      const p = phase < 1 ? phase : 2 - phase;
      el.style.transform = `translateY(${(p * 100).toFixed(2)}%)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, usable]);

  return (
    <div className="relative mx-auto w-full max-w-[280px] overflow-hidden rounded-2xl border bg-muted shadow-card" style={{ aspectRatio: "4 / 5" }}>
      <canvas ref={canvasRef} className={cn("block size-full", !usable && "hidden")} aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div ref={barRef} className="h-full w-full">
          <div className="relative h-1 w-full bg-success shadow-[0_0_14px_3px_var(--success)]">
            <div className="absolute inset-x-0 -top-10 h-10 bg-gradient-to-t from-success/30 to-transparent" />
          </div>
        </div>
      </div>
    </div>
  );
}
