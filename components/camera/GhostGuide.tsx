"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";
import { GHOST_STYLE, ghostPolylines, polylinePath, type GhostOutline } from "@/lib/face/ghostGuide";

/** Kamera önizlemesiyle aynı viewBox (SelfieCamera: 3:4, "cover"). */
export const GHOST_VIEWBOX = { w: 300, h: 400 } as const;

export type GhostPaths = { oval: string; eyes: [string, string]; mouth: string; nose: [number, number] };

/**
 * Saf: saklanan çizgiden önizleme yolları. mirror: hedef önizleme aynalı mı (web ön kamera önizlemesi -scale-x-100 →
 * true; galeri/ham kare koordinatlarıyla saklanan çizgi mirrored:false olduğundan x çevrilir).
 */
export function ghostGuidePaths(outline: GhostOutline, mirror: boolean, viewport: { w: number; h: number } = GHOST_VIEWBOX): GhostPaths {
  const p = ghostPolylines(outline, viewport, { mirror });
  return {
    oval: polylinePath(p.oval, true),
    eyes: [polylinePath(p.eyes.slice(0, 2)), polylinePath(p.eyes.slice(2, 4))],
    mouth: polylinePath(p.mouth),
    nose: p.nose,
  };
}

/**
 * Hayalet kılavuz katmanı (KB §8 ONAYLI ÖNERİ R2-Ö1; PLAN Faz 6; S3.3.4): önceki fotoğrafın yüz çizgisi kamera üstünde
 * silik durur; kullanıcı aynı açıya ve mesafeye oturur. Statik çizim (animasyon yok: prefers-reduced-motion'dan bağımsız).
 * Çizgi cihazdaki ilerleme kaydından gelir; bu bileşen hiçbir şey saklamaz, hiçbir isteğe girmez.
 */
export function GhostGuide({ outline, mirror = true }: { outline: GhostOutline; mirror?: boolean }) {
  const t = useTranslations("ghost");
  const shownRef = useRef(false);
  useEffect(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    track("ghost_guide_shown");
  }, []);
  const paths = ghostGuidePaths(outline, mirror);
  const stroke = "rgba(255,255,255,0.95)";
  return (
    <svg
      viewBox={`0 0 ${GHOST_VIEWBOX.w} ${GHOST_VIEWBOX.h}`}
      className="pointer-events-none absolute inset-0 size-full"
      role="img"
      aria-label={t("aria")}
      style={{ opacity: GHOST_STYLE.opacity }}
      data-ghost-guide=""
    >
      <g fill="none" stroke={stroke} strokeWidth={GHOST_STYLE.strokeWidth} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 4">
        <path d={paths.oval} />
        <path d={paths.eyes[0]} />
        <path d={paths.eyes[1]} />
        <path d={paths.mouth} />
      </g>
      <circle cx={paths.nose[0]} cy={paths.nose[1]} r={3} fill={stroke} />
    </svg>
  );
}
