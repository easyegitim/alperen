// Admin "Bozuk görünüyor" oranı (F18; KB §7.3/5; S3.3.6). Saf: ops.daily_tryon_quality satırlarından son N gün özeti.
// Görsel, kullanıcı kimliği yok; yalnız sayılar.
import { TRYON_BROKEN_RATE_ALERT_DEFAULT } from "@/lib/config/ops";

export type TryonQualityRow = { day: string; mode: string; success: number; qc_failed: number; identity_drift: number; flagged_broken: number; broken_rate: number };

export type TryonQualitySummary = { days: number; success: number; qcFailed: number; identityDrift: number; flaggedBroken: number; brokenRate: number | null; alert: boolean };

const dayNum = (ymd: string) => Math.floor(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000);

/** Son `days` gün (today dahil) toplamı; broken_rate = bildirilen bozuk / başarılı (başarılı 0 ise null). */
export function summarizeTryonQuality(rows: readonly TryonQualityRow[], today: string, days = 7, alertAt = TRYON_BROKEN_RATE_ALERT_DEFAULT): TryonQualitySummary {
  const from = dayNum(today) - (days - 1);
  let success = 0, qcFailed = 0, identityDrift = 0, flaggedBroken = 0;
  for (const r of rows) {
    const d = dayNum(String(r.day).slice(0, 10));
    if (!Number.isFinite(d) || d < from || d > dayNum(today)) continue;
    success += Number(r.success) || 0;
    qcFailed += Number(r.qc_failed) || 0;
    identityDrift += Number(r.identity_drift) || 0;
    flaggedBroken += Number(r.flagged_broken) || 0;
  }
  const brokenRate = success > 0 ? Math.round((flaggedBroken / success) * 10_000) / 10_000 : null;
  return { days, success, qcFailed, identityDrift, flaggedBroken, brokenRate, alert: brokenRate !== null && brokenRate > alertAt };
}

/** "%4,2" biçimi. */
export function formatRate(rate: number | null): string {
  return rate === null ? "–" : `%${(rate * 100).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}
