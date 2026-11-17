"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Kilitli halkadaki süs yayının sabit oranı. Gerçek bir değerden türetilmez (değer istemcide yoktur). */
const LOCKED_DECOR_FRACTION = 0.68;

/**
 * Dairesel skor göstergesi (F08 tasarım sistemi). Marka gradyanı tektir; renk değere göre değişmez
 * (SPEC 4.3: skorlar nötr renk skalasıyla, iyi/kötü rengi yok). value null → kilitli: bulanık, sabit süs yayı.
 * Halka yalnız süstür (aria-hidden); sayı ve erişilebilir ad ortadaki içerikte.
 */
export function ScoreRing({
  value,
  max = 10,
  size = 200,
  stroke = 14,
  animate = false,
  className,
  children,
}: {
  value: number | null;
  max?: number;
  size?: number;
  stroke?: number;
  animate?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const gid = useId();
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const locked = value === null;
  const fraction = locked ? LOCKED_DECOR_FRACTION : Math.min(Math.max(value / max, 0), 1);
  const offset = len * (1 - fraction);
  const arcStyle = { "--ring-len": `${len}px` } as CSSProperties;

  return (
    <div className={cn("relative grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90 overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--brand-to)" }} />
            <stop offset="100%" style={{ stopColor: "var(--brand-from)" }} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={offset}
          style={arcStyle}
          className={cn(locked ? "opacity-40 blur-[3px]" : "drop-shadow-[0_0_10px_var(--brand-soft)]", animate && "motion-safe:animate-ring-draw")}
        />
      </svg>
      <div className="relative flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
