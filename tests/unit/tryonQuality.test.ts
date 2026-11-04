import { describe, expect, it } from "vitest";
import { getTryonBrokenRateAlert, TRYON_BROKEN_RATE_ALERT_DEFAULT } from "@/lib/config/ops";
import { formatRate, summarizeTryonQuality } from "@/lib/ops/tryonQuality";

// F18 admin "Bozuk görünüyor" oranı (KB §7.3; S3.3.6): son 7 gün toplamı, eşik %5 (CLAUDE NOTU, env ile değişir).
const row = (day: string, mode: string, success: number, flagged: number) => ({ day, mode, success, qc_failed: 1, identity_drift: 0, flagged_broken: flagged, broken_rate: success ? flagged / success : 0 });

describe("summarizeTryonQuality", () => {
  it("son 7 gün (bugün dahil) toplanır; eski günler ve mod kırılımı toplama girer; oran = bozuk / başarılı", () => {
    const rows = [row("2026-11-04", "style", 40, 1), row("2026-11-04", "combo", 10, 1), row("2026-10-29", "style", 50, 0), row("2026-10-28", "style", 100, 50)];
    const s = summarizeTryonQuality(rows, "2026-11-04");
    expect(s).toMatchObject({ days: 7, success: 100, flaggedBroken: 2, qcFailed: 3, brokenRate: 0.02, alert: false });
  });
  it("eşik üstü vurgulanır; başarılı 0 ise oran null ve uyarı yok; eşik env ile", () => {
    expect(summarizeTryonQuality([row("2026-11-03", "style", 20, 2)], "2026-11-04").alert).toBe(true);
    expect(summarizeTryonQuality([row("2026-11-03", "style", 20, 1)], "2026-11-04", 7, 0.05)).toMatchObject({ brokenRate: 0.05, alert: false });
    expect(summarizeTryonQuality([row("2026-11-03", "style", 0, 0)], "2026-11-04")).toMatchObject({ brokenRate: null, alert: false });
    expect(getTryonBrokenRateAlert({})).toBe(TRYON_BROKEN_RATE_ALERT_DEFAULT);
    expect(getTryonBrokenRateAlert({ OPS_TRYON_BROKEN_RATE_ALERT: "0.1" })).toBe(0.1);
    expect(getTryonBrokenRateAlert({ OPS_TRYON_BROKEN_RATE_ALERT: "5" })).toBe(TRYON_BROKEN_RATE_ALERT_DEFAULT);
    expect(formatRate(0.0857)).toBe("%8,6");
    expect(formatRate(null)).toBe("–");
  });
});
