// SPEC 8.4. Kalibrasyon herkes için aynıdır; ödeme/plan/kampanya girdisi YOKTUR (D03).
import { CALIBRATION_H1, CALIBRATION_V0 } from "@/lib/config/scoring";
import type { SubKey, SubKeyV1 } from "@/lib/config/teaser";

/** h1 (engine spec §5.1): hybrid.v1 için kimlik + kenetleme; referans profil 5,5 verir. */
export type CalibrationVersion = "v0" | "v1" | "h1";

/** v1: ham → hedef yüzdelik eşleme tablosu, parça parça doğrusal (content/score-calibration.v1.json). */
export type CalibrationTable = { overall: [number, number][]; subscores?: Partial<Record<SubKey, [number, number][]>> };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const round1 = (v: number) => Math.round(v * 10) / 10;

export function calibrateV0(raw: number, sub?: SubKey): number {
  const c = CALIBRATION_V0;
  // v0 yalnız legacy altılısı için ayarlanır; v2 anahtarı (brows) genel değerlere düşer.
  const p = (sub && c.perSub[sub as SubKeyV1]) || { rawMean: c.rawMean, scale: c.scale };
  return clamp(c.target + (raw - p.rawMean) * p.scale, c.min, c.max);
}

/** Parça parça doğrusal ara değer; tablo (raw, calibrated) çiftleri artan sırada. Uçlarda sabitlenir. */
export function interpolate(table: [number, number][], raw: number): number {
  if (table.length === 0) throw new Error("calibration_table_empty");
  if (raw <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (raw >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1];
    const [x1, y1] = table[i];
    if (raw <= x1) return y0 + ((raw - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

export function calibrateV1(raw: number, table: CalibrationTable, sub?: SubKey): number {
  const t = (sub && table.subscores?.[sub]) || table.overall;
  return clamp(interpolate(t, raw), CALIBRATION_V0.min, CALIBRATION_V0.max);
}

/** h1: round1(clamp(raw, 1,0, 9,8)). Alt skor veya kullanıcı girdisi yok; herkes için aynı. */
export function calibrateH1(raw: number): number {
  return clamp(raw, CALIBRATION_H1.min, CALIBRATION_H1.max);
}

/**
 * Kalibre skor (1 ondalık). v1 için tablo verilmelidir; verilmezse hata (sahte tablo kullanılmaz).
 */
export function calibrate(raw: number, version: CalibrationVersion, opts: { sub?: SubKey; table?: CalibrationTable } = {}): number {
  if (version === "v0") return round1(calibrateV0(raw, opts.sub));
  if (version === "h1") return round1(calibrateH1(raw));
  if (!opts.table) throw new Error("calibration_v1_table_missing");
  return round1(calibrateV1(raw, opts.table, opts.sub));
}
