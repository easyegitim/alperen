// Admin/ops eşikleri (KB §7.3; CONTRACTS_V2 S3.3.6). CLAUDE NOTU: "Bozuk görünüyor" oranı %5 üstünde vurgulanır; kurucu
// kararı yok → env ile değişir (OPS_TRYON_BROKEN_RATE_ALERT, 0–1). Koda gömülü sayı yok; saf.
export const TRYON_BROKEN_RATE_ALERT_DEFAULT = 0.05;

export function getTryonBrokenRateAlert(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.OPS_TRYON_BROKEN_RATE_ALERT);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : TRYON_BROKEN_RATE_ALERT_DEFAULT;
}
