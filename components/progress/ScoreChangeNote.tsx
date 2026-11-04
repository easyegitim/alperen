"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";
import { CHANGE_LABEL_KEY, NOISE_BAND, formatBand, formatDelta, type ChangeKind } from "@/lib/progress/noise";
import { latestChange, type TrendPointLike } from "@/lib/progress/trend";
import { cn } from "@/lib/utils";

const ICON: Record<ChangeKind, typeof Minus> = { no_change: Minus, up: ArrowUpRight, down: ArrowDownRight };
const TONE: Record<ChangeKind, string> = { no_change: "bg-muted text-foreground", up: "bg-success/15 text-success", down: "bg-brand-soft text-brand" };

/**
 * Son iki analiz arasındaki fark (KB §4.2): |Δ| ≤ ±bant → "Değişim yok" ve bandın açıklaması (ışık/açı farkı). Kıyas yalnız
 * kullanıcının kendi geçmişiyle. Kalibrasyon sürümü farklıysa karşılaştırma yapılmaz. Olay yüksüz (fark/skor gitmez).
 */
export function ScoreChangeNote({ points, band = NOISE_BAND }: { points: readonly TrendPointLike[]; band?: number }) {
  const t = useTranslations();
  const tv = useTranslations("progress.v2");
  const latest = latestChange(points, band);
  const kind = latest?.change?.kind ?? null;
  const trackedRef = useRef<string | null>(null);
  useEffect(() => {
    if (kind !== "no_change" || !latest || trackedRef.current === latest.to.id) return;
    trackedRef.current = latest.to.id;
    track("progress_no_change_shown");
  }, [kind, latest]);
  if (!latest) return null;
  if (latest.calibrationChanged || !latest.change) {
    return <p className="rounded-xl border border-dashed px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">{tv("calibrationChanged")}</p>;
  }
  const c = latest.change;
  const Icon = ICON[c.kind];
  const label = t(CHANGE_LABEL_KEY[c.kind]);
  return (
    <div className="space-y-1.5" data-change-kind={c.kind}>
      <p className="flex items-center gap-2 text-[13px]">
        <span className={cn("inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold", TONE[c.kind])} role="status" aria-label={tv("changeAria", { label })}>
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </span>
        <span className="num text-muted-foreground">{tv("deltaLabel", { delta: formatDelta(c.delta) })}</span>
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {c.kind === "no_change" ? tv("noiseNote", { band: formatBand(c.band) }) : null} {tv("ownHistoryNote")}
      </p>
    </div>
  );
}
