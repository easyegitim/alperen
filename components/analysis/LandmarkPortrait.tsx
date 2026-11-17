"use client";

// Kilitli sonuç ekranının yuvarlak portresi (KB P#6, P§6): yüz kırpımı + 30–70 anahtar nokta, aynı kırpma/ölçek dönüşümü
// (lib/face/overlay.ts portraitGeometry). Yalnız tarayıcıda, bellekteki fotoğrafa çizilir; toDataURL/indirme yok; noktalar
// hiçbir yere gönderilmez. Fotoğraf yoksa (sayfa yenilendi, başka cihaz) şematik yüz.
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { SchematicFace, type OverlaySource } from "@/components/analysis/GeometryOverlay";
import { portraitGeometry } from "@/lib/face/overlay";
import { cn } from "@/lib/utils";

export function LandmarkPortrait({ source, size = 168, className }: { source: OverlaySource | null; size?: number; className?: string }) {
  const t = useTranslations("analysis.overlay");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const usable = source !== null && source.bitmap.width > 0 && !failed;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source || !usable) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const px = Math.round(size * dpr);
    const g = portraitGeometry(source.landmarks, source.width, source.height, px);
    const raf = requestAnimationFrame(() => {
      try {
        canvas.width = px;
        canvas.height = px;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(source.bitmap, g.crop.x, g.crop.y, g.crop.width, g.crop.height, 0, 0, px, px);
        // İnce yüz hattı ve noktalar: önce koyu hale, sonra açık çizim (her zeminde okunur; tek sabit renk).
        if (g.oval) {
          ctx.beginPath();
          g.oval.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
          ctx.lineWidth = 1.5 * dpr;
          ctx.strokeStyle = "rgba(0,0,0,0.35)";
          ctx.stroke();
          ctx.lineWidth = 0.8 * dpr;
          ctx.strokeStyle = "rgba(255,255,255,0.55)";
          ctx.stroke();
        }
        for (const [x, y] of g.points) {
          ctx.beginPath();
          ctx.arc(x, y, 2.6 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(0,0,0,0.45)";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x, y, 1.6 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
        }
      } catch {
        setFailed(true);
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      canvas.width = 0;
    };
  }, [source, usable, size]);

  return (
    <div
      className={cn("relative shrink-0 overflow-hidden rounded-full bg-muted ring-4 ring-brand/25 shadow-glow", !usable && "text-muted-foreground", className)}
      style={{ width: size, height: size }}
    >
      <canvas
        ref={canvasRef}
        className={cn("block size-full", !usable && "hidden")}
        {...(usable ? { role: "img", "aria-label": t("portraitAria") } : { "aria-hidden": true })}
      />
      {!usable ? <SchematicFace className="size-full p-[14%]" /> : null}
    </div>
  );
}
