// İlerleme değişimi (KB §4.2; PLAN Faz 6; CONTRACTS_V2 S3.3.3): kıyas YALNIZ kullanıcının kendi geçmişiyle; kalibrasyon
// sürümü farklı iki analiz karşılaştırılmaz; |Δ| ≤ ±bant "değişim yok". Saf; birim testli. Web lib/progress/trend.ts (W6)
// ile aynı semantik; birleştirme sonrası o modüle geçilebilir.
import type { ClientAnalysisSummary } from "@/lib/score/present";
import { NOISE_BAND, classifyChange, type ScoreChange } from "@/lib/progress/noise";

export type TrendPointLike = { id: string; date: string; overall: number; calibrationVersion: string | null };
export type LatestChange = { from: TrendPointLike; to: TrendPointLike; change: ScoreChange | null; calibrationChanged: boolean };

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

/** GET /api/analyses özetlerinden trend noktaları (yalnız tamamlanmış ve açık skorlu; ücretsizde skor null → boş). */
export function trendPointsFromSummaries(list: readonly ClientAnalysisSummary[]): (TrendPointLike & { potential: number })[] {
  return list
    .filter((p) => p.status === "completed" && p.overall !== null && p.potential !== null)
    .map((p) => ({ id: p.id, date: p.createdAt, overall: p.overall as number, potential: p.potential as number, calibrationVersion: p.calibrationVersion }));
}
