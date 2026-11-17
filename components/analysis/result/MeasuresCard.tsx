"use client";

import { Ruler } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { DeviceResult, MeasureKey, ReportV3 } from "@/lib/score/contract";

const pct = (v: number | null) => (v === null ? "–" : `%${Math.round(v * 100)}`);
const ratio = (v: number) => v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const deg = (v: number) => `${v.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}°`;

const LABEL_KEY: Record<MeasureKey, "canthalTilt" | "jawRatio" | "fwhr" | "thirds"> = { canthalTiltDeg: "canthalTilt", jawRatio: "jawRatio", fwhr: "fwhr", thirds: "thirds" };

/** Çubuk ölçeği: dengeli aralık ortada, iki yanda aralığın yarısı kadar pay; kullanıcı değeri kenetlenir. */
export function barPosition(value: number, range: [number, number]): { lo: number; hi: number; at: number } {
  const [lo, hi] = range;
  const span = Math.max(hi - lo, 1e-6);
  const min = lo - span / 2;
  const max = hi + span / 2;
  const p = (x: number) => Math.min(100, Math.max(0, ((x - min) / (max - min)) * 100));
  return { lo: p(lo), hi: p(hi), at: p(value) };
}

function fmtMeasure(key: MeasureKey, v: number): string {
  return key === "canthalTiltDeg" ? deg(v) : key === "thirds" ? pct(v) : ratio(v);
}

/**
 * Ölçüler (KB §5/3, P#12): cihaz oranları her zaman açık; rapor gelince her oran "dengeli aralık" çubuğunda kullanıcının
 * yeriyle. Kıyas yalnız bu aralıkla; yüzdelik yok; iyi/kötü rengi yok.
 */
export function MeasuresCard({ device, measures, reportReady }: { device: DeviceResult | null; measures: ReportV3["measures"] | null; reportReady: boolean }) {
  const tg = useTranslations("geometry");
  const tr = useTranslations("analysis.result.measures");
  if (!device) return null;
  const r = device.ratios;
  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Ruler aria-hidden="true" className="size-4 text-brand" />
          {tr("title")}
        </h2>
      </CardHeader>
      <CardContent className="space-y-3">
        {measures && measures.length ? (
          <ul className="space-y-3">
            {measures.map((m) => {
              const pos = barPosition(m.value, m.balancedRange);
              const name = tg(LABEL_KEY[m.key]);
              return (
                <li key={m.key} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="font-medium">{name}</span>
                    <span className="num text-muted-foreground">{fmtMeasure(m.key, m.value)}</span>
                  </div>
                  <div role="img" aria-label={tr("aria", { name, value: fmtMeasure(m.key, m.value), lo: fmtMeasure(m.key, m.balancedRange[0]), hi: fmtMeasure(m.key, m.balancedRange[1]) })} className="relative h-3 rounded-full bg-track">
                    <span className="absolute inset-y-0 rounded-full bg-brand-soft ring-1 ring-brand/30" style={{ left: `${pos.lo}%`, width: `${pos.hi - pos.lo}%` }} />
                    <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-gradient shadow-glow ring-2 ring-card" style={{ left: `${pos.at}%` }} />
                  </div>
                  <div className="num flex justify-between text-[10px] text-muted-foreground" aria-hidden="true">
                    <span>{tr("balanced")}: {fmtMeasure(m.key, m.balancedRange[0])}–{fmtMeasure(m.key, m.balancedRange[1])}</span>
                    <span>{tr("yours")}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <dl className="grid grid-cols-2 gap-2">
            {(
              [
                ["canthalTilt", r.canthalTiltDeg > 2 ? tg("tilt.positive") : r.canthalTiltDeg < -2 ? tg("tilt.negative") : tg("tilt.neutral")],
                ["thirds", `${pct(r.thirds.upper)} / ${pct(r.thirds.middle)} / ${pct(r.thirds.lower)}`],
                ["fwhr", ratio(r.fwhr)],
                ["jawRatio", ratio(r.jawRatio)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex min-h-20 flex-col justify-between gap-2 rounded-xl bg-muted/60 p-3">
                <dt className="text-[11px] leading-tight text-muted-foreground">{tg(k)}</dt>
                <dd className="num text-sm leading-tight font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">{measures && measures.length ? tr("note") : reportReady ? tg("note") : `${tg("note")} ${tr("deviceOnly")}`}</p>
      </CardContent>
    </Card>
  );
}
