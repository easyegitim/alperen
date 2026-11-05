"use client";

// Fotoğraf üzerindeki ölçü çizgileri (UI spec §2.5, S2). Yalnız tarayıcıda, bellekteki görüntüye çizilir:
// toDataURL/toBlob/indirme/paylaşım yok, sayı çizilmez, görüntü ve noktalar state/analitik/depolamaya girmez.
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { OVERLAY_LAYER_KEYS, faceCrop, overlayLayers, type OverlayLayerKey, type Polyline } from "@/lib/face/overlay";
import type { Point } from "@/lib/face/types";
import { cn } from "@/lib/utils";

export type { OverlayLayerKey } from "@/lib/face/overlay";
export type OverlaySource = { bitmap: ImageBitmap; width: number; height: number; landmarks: Point[] /* piksel */ };

type Variant = "thumb" | "full" | "scan";
/** Görüntü kutusu genişliği (CSS px) ve en-boy oranı (4:5). */
const BOX: Record<Variant, { cssWidth: number; aspect: number }> = {
  thumb: { cssWidth: 96, aspect: 0.8 },
  full: { cssWidth: 360, aspect: 0.8 },
  scan: { cssWidth: 280, aspect: 0.8 },
};
const LAYER_STEP_MS = 150;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function GeometryOverlay({
  source,
  variant,
  showLines = true,
  animate = false,
  notMeasured = [],
  srLegend = true,
  className,
}: {
  source: OverlaySource | null;
  variant: Variant;
  showLines?: boolean;
  /** Katmanlar 150 ms arayla çizilir (azaltılmış harekette hemen son hal). */
  animate?: boolean;
  /** Bu çekimde ölçülmeyen katmanlar kesikli çizilir (durum yalnız renkle gösterilmez). */
  notMeasured?: OverlayLayerKey[];
  /** Görünür bir açıklama listesi yoksa ekran okuyucu için anlamlar listesi. */
  srLegend?: boolean;
  className?: string;
}) {
  const t = useTranslations("analysis.overlay");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sweepRef = useRef<HTMLDivElement>(null);
  const [failedFor, setFailedFor] = useState<OverlaySource | null>(null);
  const box = BOX[variant];
  // Kapanmış ImageBitmap'in genişliği 0'dır (setSessionSelfie değiştirdi veya çekim ekranı bıraktı).
  const usable = source !== null && source.bitmap.width > 0 && failedFor !== source;

  const geometry = useMemo(() => {
    if (!source) return null;
    return { crop: faceCrop(source.landmarks, source.width, source.height, 0.25, box.aspect), layers: overlayLayers(source.landmarks) };
  }, [source, box.aspect]);

  const notMeasuredKey = notMeasured.join(",");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source || !geometry || !usable) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const { crop, layers } = geometry;
    const w = Math.max(1, Math.round(Math.min(crop.width, box.cssWidth * dpr)));
    const h = Math.max(1, Math.round(w / box.aspect));
    const dashed = new Set(notMeasuredKey ? (notMeasuredKey.split(",") as OverlayLayerKey[]) : []);
    const lineScale = (w / box.cssWidth) * (variant === "thumb" ? 0.75 : 1);
    const order = OVERLAY_LAYER_KEYS.filter((k) => layers[k].length > 0);
    const timers: number[] = [];

    const paint = (visible: number) => {
      try {
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(source.bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);
        if (!showLines) return;
        const s = w / crop.width;
        const sy = h / crop.height;
        const path = (pl: Polyline) => {
          ctx.beginPath();
          pl.forEach(([x, y], i) => {
            const px = (x - crop.x) * s;
            const py = (y - crop.y) * sy;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
        };
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const key of order.slice(0, visible)) {
          ctx.setLineDash(dashed.has(key) ? [6 * lineScale, 5 * lineScale] : []);
          // Önce koyu hale, sonra beyaz çizgi: her zeminde okunur. Halenin rengi tek sabit renktir.
          for (const [style, width] of [
            ["rgba(0,0,0,0.55)", 3.5],
            ["#ffffff", 2],
          ] as const) {
            ctx.strokeStyle = style;
            ctx.lineWidth = width * lineScale;
            for (const pl of layers[key]) {
              path(pl);
              ctx.stroke();
            }
          }
        }
      } catch {
        setFailedFor(source);
      }
    };

    // Çizim kare geri çağrısında: state yalnız hata halinde ve efekt gövdesi dışında değişir.
    const raf = requestAnimationFrame(() => {
      if (animate && showLines && !prefersReducedMotion()) {
        paint(0);
        order.forEach((_, i) => timers.push(window.setTimeout(() => paint(i + 1), (i + 1) * LAYER_STEP_MS)));
      } else {
        paint(order.length);
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach((id) => clearTimeout(id));
    };
  }, [source, geometry, usable, showLines, animate, notMeasuredKey, box.cssWidth, box.aspect, variant]);

  // Ayrılırken tuval belleği bırakılır; bitmap'i bu bileşen kapatmaz (sahibi sessionStore / çekim ekranı).
  useEffect(() => {
    const canvas = canvasRef.current;
    return () => {
      if (canvas) canvas.width = 0;
    };
  }, []);

  // Tarama çizgisi: yavaş yukarı-aşağı; azaltılmış harekette kapalı. React state'i değil, doğrudan transform.
  useEffect(() => {
    const el = sweepRef.current;
    if (variant !== "scan" || !el || prefersReducedMotion()) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const phase = ((now - start) / 2400) % 2;
      const p = phase < 1 ? phase : 2 - phase;
      el.style.transform = `translateY(${(p * 100).toFixed(2)}%)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [variant, usable]);

  const layerNames = OVERLAY_LAYER_KEYS.map((k) => t(`layers.${k}`)).join(", ");
  const sizeClass = variant === "thumb" ? "h-[120px] w-24" : variant === "scan" ? "w-full max-w-[280px]" : "w-full max-w-[360px]";

  return (
    <div className={cn("mx-auto space-y-2", variant !== "thumb" && "w-full", className)}>
      <div className={cn("relative mx-auto overflow-hidden rounded-lg bg-muted", !usable && "text-muted-foreground", sizeClass)} style={{ aspectRatio: "4 / 5" }}>
        {/* Tuval her zaman DOM'da: ayrılırken belleği bırakılabilsin; fotoğraf yoksa gizli. */}
        <canvas
          ref={canvasRef}
          className={cn("block size-full", !usable && "hidden")}
          {...(variant === "thumb" || !usable ? { "aria-hidden": true } : { role: "img", "aria-label": t("canvasAria", { layers: layerNames }) })}
        />
        {!usable ? <SchematicFace className="size-full p-[10%]" /> : null}
        {usable && variant === "scan" ? (
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div ref={sweepRef} className="h-full w-full">
              <div className="h-0.5 w-full bg-white/80 shadow-[0_0_8px_2px_rgba(255,255,255,0.45)]" />
            </div>
          </div>
        ) : null}
      </div>
      {!usable && variant === "full" ? <p className="text-xs text-muted-foreground">{t("fallbackNote")}</p> : null}
      {usable && variant !== "thumb" && srLegend ? (
        <ul className="sr-only">
          {OVERLAY_LAYER_KEYS.map((k) => (
            <li key={k}>
              {t(`layers.${k}`)}: {t(`meaning.${k}`)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Fotoğraf yokken (sayfa yenilendi, başka cihaz) şematik yüz: yalnız tema rengi (currentColor), sayı yok. */
export function SchematicFace({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 125" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <ellipse cx="50" cy="60" rx="34" ry="46" />
      <path d="M50 14 V106" strokeDasharray="2 3" />
      <path d="M16 44 H84 M16 72 H84 M16 106 H84" strokeOpacity="0.6" />
      <path d="M28 50 L42 49 M58 49 L72 50" />
      <path d="M35 49 L65 49" strokeDasharray="1 3" strokeOpacity="0.7" />
      <path d="M17 62 L83 62 M27 88 L73 88" strokeOpacity="0.6" />
    </svg>
  );
}
