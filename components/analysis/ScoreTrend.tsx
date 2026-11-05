"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { ScoreChangeNote } from "@/components/progress/ScoreChangeNote";
import { NOISE_BAND } from "@/lib/progress/noise";

export type TrendPoint = { id: string; date: string; overall: number; potential: number; calibrationVersion: string | null };

const W = 320, H = 160, PAD = { l: 28, r: 12, t: 12, b: 24 };
const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Skor trendi (SPEC 11.2 / Faz 7 madde 5): genel skor ve potansiyel; tek eksen, 2 px çizgi, ≥8 px işaret,
 * lejant + son noktada doğrudan etiket, dokunma/hover ipucu. Kalibrasyon sürümü değişmişse dipnot.
 * Faz 6 (KB §4.2): son iki analiz arası fark ±band içindeyse "Değişim yok" etiketi ve bant açıklaması (ScoreChangeNote);
 * band tek kaynak NOISE_BAND (ClientAnalysisV2.noiseBand ile aynı). Kıyas yalnız kendi geçmişiyle.
 */
export function ScoreTrend({ points, band = NOISE_BAND }: { points: TrendPoint[]; band?: number }) {
  const t = useTranslations("analysis.trend");
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const data = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (data.length < 2) return <p className="text-xs text-muted-foreground">{t("needTwo")}</p>;

  const vals = data.flatMap((p) => [p.overall, p.potential]);
  const lo = Math.max(1, Math.floor(Math.min(...vals)) - 1);
  const hi = Math.min(10, Math.ceil(Math.max(...vals)) + 1);
  const x = (i: number) => PAD.l + (i / (data.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const path = (key: "overall" | "potential") => data.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const versions = new Set(data.map((p) => p.calibrationVersion ?? "v0"));
  const last = data.length - 1;
  const ticks = [lo, (lo + hi) / 2, hi];

  return (
    <figure className="viz-root space-y-2" aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`} className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t("title")}</span>
        <span className="flex gap-3" aria-hidden="true">
          <span className="flex items-center gap-1"><i className="inline-block size-2 rounded-full" style={{ background: "var(--series-1)" }} />{t("overall")}</span>
          <span className="flex items-center gap-1"><i className="inline-block size-2 rounded-full" style={{ background: "var(--series-2)" }} />{t("potential")}</span>
        </span>
      </figcaption>
      <style>{`.viz-root{--series-1:#2a78d6;--series-2:#eb6834}.dark .viz-root{--series-1:#3987e5;--series-2:#d95926}`}</style>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none" role="img" aria-label={t("aria", { n: data.length })} onPointerLeave={() => setActive(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.12} />
            <text x={PAD.l - 4} y={y(v) + 3} fontSize={9} textAnchor="end" fill="currentColor" fillOpacity={0.6}>{fmt(v)}</text>
          </g>
        ))}
        <path d={path("potential")} fill="none" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="4 3" />
        <path d={path("overall")} fill="none" stroke="var(--series-1)" strokeWidth={2} />
        {data.map((p, i) => (
          <g key={p.id}>
            <rect x={x(i) - 14} y={PAD.t} width={28} height={H - PAD.t - PAD.b} fill="transparent" onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)} />
            <circle cx={x(i)} cy={y(p.potential)} r={4} fill="var(--series-2)" stroke="var(--background)" strokeWidth={2} pointerEvents="none" />
            <circle cx={x(i)} cy={y(p.overall)} r={4} fill="var(--series-1)" stroke="var(--background)" strokeWidth={2} pointerEvents="none" />
            <text x={x(i)} y={H - 8} fontSize={9} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"} fill="currentColor" fillOpacity={0.6}>
              {new Date(p.date).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })}
            </text>
          </g>
        ))}
        <text x={x(last) + 6} y={y(data[last].overall) + 3} fontSize={10} fill="currentColor" textAnchor="start">{fmt(data[last].overall)}</text>
        {active !== null ? (
          <g pointerEvents="none">
            <line x1={x(active)} x2={x(active)} y1={PAD.t} y2={H - PAD.b} stroke="currentColor" strokeOpacity={0.3} />
            <rect x={Math.min(x(active) + 6, W - 96)} y={PAD.t} width={90} height={40} rx={4} fill="var(--background)" stroke="currentColor" strokeOpacity={0.2} />
            <text x={Math.min(x(active) + 12, W - 90)} y={PAD.t + 14} fontSize={9} fill="currentColor">
              {new Date(data[active].date).toLocaleDateString("tr-TR")}
            </text>
            <text x={Math.min(x(active) + 12, W - 90)} y={PAD.t + 26} fontSize={9} fill="currentColor">{t("overall")}: {fmt(data[active].overall)}</text>
            <text x={Math.min(x(active) + 12, W - 90)} y={PAD.t + 36} fontSize={9} fill="currentColor">{t("potential")}: {fmt(data[active].potential)}</text>
          </g>
        ) : null}
      </svg>
      <table className="sr-only">
        <caption>{t("title")}</caption>
        <thead><tr><th>{t("date")}</th><th>{t("overall")}</th><th>{t("potential")}</th></tr></thead>
        <tbody>{data.map((p) => <tr key={p.id}><td>{p.date}</td><td>{fmt(p.overall)}</td><td>{fmt(p.potential)}</td></tr>)}</tbody>
      </table>
      {versions.size > 1 ? <p className="text-xs text-muted-foreground">{t("calibrationNote")}</p> : null}
      <ScoreChangeNote points={data} band={band} />
    </figure>
  );
}
