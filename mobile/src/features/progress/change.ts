// İlerleme değişimi (KB §4.2; PLAN Faz 6; CONTRACTS_V2 S3.3.3): kıyas YALNIZ kullanıcının kendi geçmişiyle; kalibrasyon
// sürümü farklı iki analiz karşılaştırılmaz; |Δ| ≤ ±bant "değişim yok". Saf çekirdek web ile ortak (lib/progress/trend.ts, W6).
import type { ClientAnalysisSummary } from "@/lib/score/present";
import type { TrendPointLike } from "@/lib/progress/trend";

export { comparable, latestChange, type LatestChange, type TrendPointLike } from "@/lib/progress/trend";

/** GET /api/analyses özetlerinden trend noktaları (yalnız tamamlanmış ve açık skorlu; ücretsizde skor null → boş). */
export function trendPointsFromSummaries(list: readonly ClientAnalysisSummary[]): (TrendPointLike & { potential: number })[] {
  return list
    .filter((p) => p.status === "completed" && p.overall !== null && p.potential !== null)
    .map((p) => ({ id: p.id, date: p.createdAt, overall: p.overall as number, potential: p.potential as number, calibrationVersion: p.calibrationVersion }));
}
