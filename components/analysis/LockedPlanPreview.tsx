"use client";

// "Sana özel plan" kartı (KB P#14, Ç13): örnek stil görselleri = kullanıcının kendi fotoğrafının hafif değiştirilmiş, çok
// bulanık hali; etiketsiz. CİHAZDA canvas ile üretilir (LLM/görsel modeli yok, kredi harcanmaz). Fotoğraf yoksa yalnız
// gradyan yer tutucular. toDataURL/indirme/paylaşım yok; hiçbir şey ağa çıkmaz.
import { Lock, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import type { OverlaySource } from "@/components/analysis/GeometryOverlay";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { faceCrop } from "@/lib/face/overlay";
import { cn } from "@/lib/utils";

/** Üç önizleme: hafif ölçek/eğim farkı ve ton kayması (sabit; fotoğrafa bağlı değil). */
const VARIANTS = [
  { scaleX: 1.0, scaleY: 1.04, skew: 0.0, hue: 0, sat: 1.05 },
  { scaleX: 0.97, scaleY: 1.0, skew: 0.04, hue: -6, sat: 1.1 },
  { scaleX: 1.03, scaleY: 0.98, skew: -0.03, hue: 5, sat: 0.95 },
] as const;

export function LockedPlanPreview({ source, onTap }: { source: OverlaySource | null; onTap: () => void }) {
  const t = useTranslations("analysis");
  return (
    <Card className="border-brand-gradient bg-hero-glow">
      <CardHeader>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
            <Sparkles className="size-4" />
          </span>
          <span className="flex-1">{t("locked.planPreviewTitle")}</span>
          <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
        </h2>
        <CardDescription>{t("locked.planPreviewBody")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="grid grid-cols-3 gap-2" aria-label={t("locked.planPreviewAria")}>
          {VARIANTS.map((v, i) => (
            <li key={i} className="relative aspect-[4/5] overflow-hidden rounded-xl border bg-muted">
              <PreviewTile source={source} variant={v} />
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/40 to-transparent" aria-hidden="true" />
            </li>
          ))}
        </ul>
        <Button className="w-full" variant="outline" onClick={onTap}>
          <Lock aria-hidden="true" />
          {t("unlock")}
        </Button>
      </CardContent>
    </Card>
  );
}

function PreviewTile({ source, variant }: { source: OverlaySource | null; variant: (typeof VARIANTS)[number] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const usable = source !== null && source.bitmap.width > 0;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !source || !usable) return;
    const crop = faceCrop(source.landmarks, source.width, source.height, 0.35, 0.8);
    const w = 160;
    const h = 200;
    const raf = requestAnimationFrame(() => {
      try {
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.filter = `blur(9px) saturate(${variant.sat}) hue-rotate(${variant.hue}deg)`;
        ctx.setTransform(variant.scaleX, 0, variant.skew, variant.scaleY, (w * (1 - variant.scaleX)) / 2, (h * (1 - variant.scaleY)) / 2);
        ctx.drawImage(source.bitmap, crop.x, crop.y, crop.width, crop.height, -8, -10, w + 16, h + 20);
      } catch {
        // çizilemezse yer tutucu gradyan kalır
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      canvas.width = 0;
    };
  }, [source, usable, variant]);
  return (
    <>
      <canvas ref={ref} className={cn("block size-full", !usable && "hidden")} aria-hidden="true" />
      {!usable ? <span className="block size-full bg-brand-gradient opacity-25 blur-sm" aria-hidden="true" /> : null}
    </>
  );
}
