// Skor trendi ölçekleme (SPEC 11.2 / Faz 7 madde 5). Saf; birim testli. Çizim Skia ile (ScoreTrend.tsx).
export type TrendPoint = { id: string; date: string; overall: number; potential: number; calibrationVersion: string | null };

export const TREND_PAD = { l: 28, r: 12, t: 12, b: 24 } as const;

export function trendScale(points: TrendPoint[], W: number, H: number) {
  const data = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const vals = data.flatMap((p) => [p.overall, p.potential]);
  const lo = vals.length ? Math.max(1, Math.floor(Math.min(...vals)) - 1) : 1;
  const hi = vals.length ? Math.min(10, Math.ceil(Math.max(...vals)) + 1) : 10;
  const x = (i: number) => TREND_PAD.l + (data.length > 1 ? (i / (data.length - 1)) * (W - TREND_PAD.l - TREND_PAD.r) : (W - TREND_PAD.l - TREND_PAD.r) / 2);
  const y = (v: number) => TREND_PAD.t + (1 - (v - lo) / Math.max(hi - lo, 1e-6)) * (H - TREND_PAD.t - TREND_PAD.b);
  const versions = new Set(data.map((p) => p.calibrationVersion ?? "v0"));
  return { data, lo, hi, x, y, ticks: [lo, (lo + hi) / 2, hi], calibrationChanged: versions.size > 1 };
}

/** SVG benzeri yol dizgesi (Skia Path.MakeFromSVGString ile çizilir). */
export function linePath(data: TrendPoint[], key: "overall" | "potential", x: (i: number) => number, y: (v: number) => number): string {
  return data.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
}
