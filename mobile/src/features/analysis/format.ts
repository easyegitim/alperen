// Skor biçimleri (KB §4.5–4.6): tek ondalık, aralık, yüzdelik eki, ölçü biçimi, dengeli aralık çubuğu. Saf; web
// components/analysis/result/{format,MeasuresCard}.ts ile aynı kurallar (mobil @/components/* içe aktaramaz).
import type { MeasureKey, ScoreRange } from "@/lib/score/contract";

export const fmt1 = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "5,6–6,0" parçaları. */
export function formatRange(r: ScoreRange): { lo: string; hi: string } {
  return { lo: fmt1(r[0]), hi: fmt1(r[1]) };
}

const UNIT_SUFFIX: Record<number, string> = { 1: "inden", 2: "sinden", 3: "ünden", 4: "ünden", 5: "inden", 6: "sından", 7: "sinden", 8: "inden", 9: "undan" };
const TENS_SUFFIX: Record<number, string> = { 10: "undan", 20: "sinden", 30: "undan", 40: "ından", 50: "sinden", 60: "ından", 70: "inden", 80: "inden", 90: "ından" };

export function percentileSuffix(p: number): string {
  const unit = p % 10;
  if (unit !== 0) return UNIT_SUFFIX[unit] ?? "inden";
  return TENS_SUFFIX[p] ?? "inden";
}

/** Yüzdelik 1–99'a kırpılır; ek ünlü uyumuna göre. */
export function formatPercentile(raw: number | null | undefined): { p: number; suffix: string } | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  const p = Math.min(99, Math.max(1, Math.round(raw)));
  return { p, suffix: percentileSuffix(p) };
}

export const MEASURE_LABEL_KEY: Record<MeasureKey, "canthalTilt" | "jawRatio" | "fwhr" | "thirds"> = { canthalTiltDeg: "canthalTilt", jawRatio: "jawRatio", fwhr: "fwhr", thirds: "thirds" };

export const pct = (v: number | null) => (v === null ? "–" : `%${Math.round(v * 100)}`);
export const ratio = (v: number) => v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const deg = (v: number) => `${v.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}°`;

export function fmtMeasure(key: MeasureKey, v: number): string {
  return key === "canthalTiltDeg" ? deg(v) : key === "thirds" ? pct(v) : ratio(v);
}

/** Çubuk ölçeği: dengeli aralık ortada, iki yanda aralığın yarısı kadar pay; kullanıcı değeri kenetlenir (0–100). */
export function barPosition(value: number, range: [number, number]): { lo: number; hi: number; at: number } {
  const [lo, hi] = range;
  const span = Math.max(hi - lo, 1e-6);
  const min = lo - span / 2;
  const max = hi + span / 2;
  const p = (x: number) => Math.min(100, Math.max(0, ((x - min) / (max - min)) * 100));
  return { lo: p(lo), hi: p(hi), at: p(value) };
}
