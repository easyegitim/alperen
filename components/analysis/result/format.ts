// Skor biçimleri (KB §4.5–4.6): tek ondalık, aralık satırı, genel skor yüzdeliği. Saf; birim testi var.
import type { ScoreRange } from "@/lib/score/contract";

export const fmt1 = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "5,6–6,0" (en dash). */
export function formatRange(r: ScoreRange): { lo: string; hi: string } {
  return { lo: fmt1(r[0]), hi: fmt1(r[1]) };
}

/**
 * Yüzdelik: "İnsanların %62'sinden yüksek". Sayı tam sayıya yuvarlanır ve 1–99 aralığına kırpılır (yüzdelik 0 ya da
 * 100 ekrana gitmez). Ek, sayının son söylenen kelimesine göre seçilir (ünlü uyumu + ulama).
 */
const UNIT_SUFFIX: Record<number, string> = { 1: "inden", 2: "sinden", 3: "ünden", 4: "ünden", 5: "inden", 6: "sından", 7: "sinden", 8: "inden", 9: "undan" };
const TENS_SUFFIX: Record<number, string> = { 10: "undan", 20: "sinden", 30: "undan", 40: "ından", 50: "sinden", 60: "ından", 70: "inden", 80: "inden", 90: "ından" };

export function percentileSuffix(p: number): string {
  const unit = p % 10;
  if (unit !== 0) return UNIT_SUFFIX[unit] ?? "inden";
  return TENS_SUFFIX[p] ?? "inden";
}

export function formatPercentile(raw: number | null | undefined): { p: number; suffix: string } | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  const p = Math.min(99, Math.max(1, Math.round(raw)));
  return { p, suffix: percentileSuffix(p) };
}
