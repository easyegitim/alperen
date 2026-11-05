import "server-only";

import { NOISE_BAND, getCalibrationH2, type CalibrationH2 } from "@/lib/config/engine.h2.server";
import type { ScoreRange } from "@/lib/score/contract";

// Kalibrasyon h2 (KB §4.4 "dürüst sıra, yumuşak ölçek"; CONTRACTS_V2 §4): ham cetvel puanı → z → center + z·sd → clamp →
// round1. Herkes için aynı (K1); ödeme, plan veya kampanya girdisi yoktur. Referans set (KB §4.3) gelene kadar z,
// cetvelin yayımlanan çapalarıyla hesaplanır: çapa 3 ("tipik") = 5,5 ve çapalar arası ≈ 1,75 puan; tipik kullanıcı
// kitlesinin çapa 2–4 arasında (±1 SS) dağıldığı varsayımıyla ham SS = 1,5. Referans set gelince bu iki sabit
// (ve gerekirse sıra eşleme tablosu) kalibrasyon sürümü artırılarak değiştirilir.

export const RUBRIC_REFERENCE = { mean: 5.5, sd: 1.5 } as const;

export const round1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Ham cetvel puanının referans dağılımdaki z değeri. */
export function zFromRaw(raw: number, ref: { mean: number; sd: number } = RUBRIC_REFERENCE): number {
  return (raw - ref.mean) / ref.sd;
}

/** Kalibre skor (1 ondalık). Varsayılan merkez 5,5 / SS 1,5 ile ham puan kendisine eşlenir (kimlik + kenetleme). */
export function calibrateH2(raw: number, cal: CalibrationH2 = getCalibrationH2(), ref: { mean: number; sd: number } = RUBRIC_REFERENCE): number {
  return round1(clamp(cal.center + zFromRaw(raw, ref) * cal.sd, cal.min, cal.max));
}

/** Standart normal CDF (Abramowitz–Stegun 7.1.26; mutlak hata < 1,5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2; // Φ(z) = ½(1 + erf(z/√2))
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  const p = 0.5 * (1 + erf);
  return z >= 0 ? p : 1 - p;
}

/** Genel skor yüzdeliği (Ç6): normal dağılımda "insanların %p'sinden yüksek"; yalnız FEATURE_PERCENTILE açıkken sunulur. 1 ondalık, 0–100. */
export function percentileH2(raw: number, ref: { mean: number; sd: number } = RUBRIC_REFERENCE): number {
  return round1(clamp(100 * normalCdf(zFromRaw(raw, ref)), 0, 100));
}

/**
 * Gösterilen aralığın yarı genişliği (KB §4.5 örneği 6,4 → 6,2–6,6). Gürültü bandının (±0,3) yarısı tek ondalıkta
 * 0,2'ye yuvarlanır; NOISE_BAND ile tutarlı: aralık bandın içinde kalır.
 */
export const RANGE_HALF_WIDTH = Math.min(NOISE_BAND, 0.2);

/** [alt, üst]: değer içinde, tek ondalık, ölçek sınırlarına kenetli. */
export function rangeAround(value: number, cal: CalibrationH2 = getCalibrationH2()): ScoreRange {
  return [round1(clamp(value - RANGE_HALF_WIDTH, cal.min, cal.max)), round1(clamp(value + RANGE_HALF_WIDTH, cal.min, cal.max))];
}

/** Kalibrasyonun eğimi (kalibre puan / ham puan); kazançları ekran ölçeğine çevirmek için. */
export function calibrationSlope(cal: CalibrationH2 = getCalibrationH2(), ref: { mean: number; sd: number } = RUBRIC_REFERENCE): number {
  return cal.sd / ref.sd;
}
