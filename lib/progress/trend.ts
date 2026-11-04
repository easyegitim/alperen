// İlerleme trendi (KB §4.2; PLAN Faz 6; CONTRACTS_V2 S3.3.3). Saf; web ve mobil. Kıyas YALNIZ kullanıcının kendi geçmişiyle:
// kullanıcılar arası sıralama/yüzdelik yok (K4). Kalibrasyon sürümü farklı iki analiz karşılaştırılmaz.
import { NOISE_BAND, classifyChange, type ScoreChange } from "./noise";

export type TrendPointLike = { id: string; date: string; overall: number; calibrationVersion: string | null };

export type LatestChange = { from: TrendPointLike; to: TrendPointLike; change: ScoreChange | null; calibrationChanged: boolean };

/** İki analiz aynı kalibrasyonla mı (ikisi de null → eski motor, aynı sayılır). */
export function comparable(a: TrendPointLike, b: TrendPointLike): boolean {
  return (a.calibrationVersion ?? "v0") === (b.calibrationVersion ?? "v0");
}

/** Tarihe göre son iki analiz; tek analiz varsa null. Kalibrasyon farklıysa change null + calibrationChanged. */
export function latestChange(points: readonly TrendPointLike[], band: number = NOISE_BAND): LatestChange | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const to = sorted[sorted.length - 1], from = sorted[sorted.length - 2];
  const ok = comparable(from, to);
  return { from, to, change: ok ? classifyChange(from.overall, to.overall, band) : null, calibrationChanged: !ok };
}
