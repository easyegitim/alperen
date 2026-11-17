"use client";

import { Ruler } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { LockedSection } from "@/components/analysis/LockedSection";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { PaywallTrigger } from "@/lib/config/paywall";
import type { DeviceResult } from "@/lib/score/contract";
import type { ClientAnalysis } from "@/lib/score/present";

const pct = (v: number | null) => (v === null ? "–" : `%${Math.round(v * 100)}`);
/** Türkçe ondalık virgülü: "1,90" (diğer skorlarla aynı biçim). */
const ratio = (v: number) => v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ROWS = ["canthalTilt", "thirds", "fwhr", "jawRatio"] as const;

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-20 flex-col justify-between gap-2 rounded-xl bg-muted/60 p-3">
      <dt className="text-[11px] leading-tight text-muted-foreground">{label}</dt>
      <dd className="num text-base leading-tight font-semibold">{children}</dd>
    </div>
  );
}

/** Oranlar (UI spec §2.7): kilitliyken adlandırılmış kutular "●,●" ile görünür, değer yoktur. */
export function MeasurementsCard({ a, onLocked }: { a: ClientAnalysis; onLocked: (t: PaywallTrigger) => void }) {
  const t = useTranslations("analysis");
  const tg = useTranslations("geometry");
  const metrics = a.metrics.locked ? null : a.metrics.value;
  return (
    <LockedSection
      title={t("ratiosTitle")}
      icon={<Ruler className="size-4" />}
      ctaVariant="outline"
      locked={a.metrics.locked}
      onTap={() => onLocked("measurements")}
      preview={
        <dl className="grid grid-cols-2 gap-2">
          {ROWS.map((k) => (
            <Tile key={k} label={tg(k)}>
              <span className="text-muted-foreground blur-[1px]" aria-hidden="true">
                ●,●
              </span>
            </Tile>
          ))}
        </dl>
      }
    >
      {metrics ? (
        <dl className="grid grid-cols-2 gap-2">
          <Tile label={tg("canthalTilt")}>
            <span className="text-sm">
              {metrics.canthalTiltDeg > 2 ? tg("tilt.positive") : metrics.canthalTiltDeg < -2 ? tg("tilt.negative") : tg("tilt.neutral")}
            </span>
          </Tile>
          <Tile label={tg("thirds")}>
            <span className="text-sm whitespace-nowrap">
              {pct(metrics.thirds.upper)} / {pct(metrics.thirds.middle)} / {pct(metrics.thirds.lower)}
            </span>
          </Tile>
          <Tile label={tg("fwhr")}>{ratio(metrics.fwhr)}</Tile>
          <Tile label={tg("jawRatio")}>{ratio(metrics.jawRatio)}</Tile>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">–</p>
      )}
    </LockedSection>
  );
}

// ─── v2: cihaz oranları, herkese açık (KB P#12; cihaz değerleri tek kaynak) ─────────────────────────────────────────

/** Ödeme öncesi dört oran açık; altında KB P§1 notu: "Bu oranlar yalnız tarif eder; iyi ya da kötü anlamı taşımaz…" */
export function DeviceMeasurementsCard({ ratios }: { ratios: DeviceResult["ratios"] }) {
  const t = useTranslations("analysis");
  const tg = useTranslations("geometry");
  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
            <Ruler className="size-4" />
          </span>
          <span className="flex-1">{t("ratiosTitle")}</span>
          <span className="inline-flex h-6 items-center rounded-full bg-success/12 px-2.5 text-[11px] font-semibold text-success">{t("locked.open")}</span>
        </h2>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-2">
          <Tile label={tg("canthalTilt")}>
            <span className="text-sm">{ratios.canthalTiltDeg > 2 ? tg("tilt.positive") : ratios.canthalTiltDeg < -2 ? tg("tilt.negative") : tg("tilt.neutral")}</span>
          </Tile>
          <Tile label={tg("thirds")}>
            <span className="text-sm whitespace-nowrap">
              {pct(ratios.thirds.upper)} / {pct(ratios.thirds.middle)} / {pct(ratios.thirds.lower)}
            </span>
          </Tile>
          <Tile label={tg("fwhr")}>{ratio(ratios.fwhr)}</Tile>
          <Tile label={tg("jawRatio")}>{ratio(ratios.jawRatio)}</Tile>
        </dl>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{t("locked.ratiosNote")}</p>
      </CardContent>
    </Card>
  );
}
