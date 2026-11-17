"use client";

import { useTranslations } from "next-intl";
import { fmtScore } from "@/components/analysis/LockedValue";
import { cn } from "@/lib/utils";

const MIN = 1;
const MAX = 10;
const pos = (v: number) => `${((Math.min(Math.max(v, MIN), MAX) - MIN) / (MAX - MIN)) * 100}%`;

/**
 * 1–10 nötr ölçek (UI spec §2.4): herkes için aynı referans çizgisi + (açıksa) kullanıcının işareti.
 * Renk skalası, iyi/kötü rengi, yüzdelik veya "ortalama" yok: iz tek nötr renk, işaret marka rengi.
 */
export function ReferenceScale({ reference, value, className }: { reference: number; value: number | null; className?: string }) {
  const t = useTranslations("analysis.reference");
  const ref = fmtScore(reference);
  return (
    <div
      role="img"
      aria-label={value === null ? t("ariaLocked", { ref }) : t("aria", { ref, value: fmtScore(value) })}
      className={cn("space-y-1.5", className)}
    >
      <div className="relative h-1.5 rounded-full bg-track">
        <span className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground" style={{ left: pos(reference) }} />
        {value !== null ? (
          <span
            className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-gradient shadow-glow ring-2 ring-card"
            style={{ left: pos(value) }}
          />
        ) : null}
      </div>
      <div className="num relative h-4 text-[11px] text-muted-foreground" aria-hidden="true">
        <span className="absolute left-0">{MIN}</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pos(reference) }}>
          {t("tick", { ref })}
        </span>
        <span className="absolute right-0">{MAX}</span>
      </div>
    </div>
  );
}
