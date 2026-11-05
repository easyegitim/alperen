import { describe, expect, it } from "vitest";
import { claimErrorKey, referralRatio } from "@/lib/referral/claim";

// Faz 6 davet kodu girişi (S3.3.5): tek rota POST /api/referral { code }; hata eşlemesi referral.claim.errors.*.
describe("claimErrorKey", () => {
  it("BAD_INPUT mesajındaki neden; bayrak kapalı → disabled; diğerleri generic", () => {
    expect(claimErrorKey("BAD_INPUT", "unknown_code")).toBe("unknown_code");
    expect(claimErrorKey("BAD_INPUT", "self")).toBe("self");
    expect(claimErrorKey("BAD_INPUT", "already_claimed")).toBe("already_claimed");
    expect(claimErrorKey("BAD_INPUT", "device_check_failed")).toBe("device");
    expect(claimErrorKey("BAD_INPUT", "Geçersiz girdi.")).toBe("generic");
    expect(claimErrorKey("FEATURE_DISABLED", "Bulunamadı.")).toBe("disabled");
    expect(claimErrorKey("NETWORK")).toBe("generic");
    expect(claimErrorKey("RATE_LIMITED", "self")).toBe("generic");
  });
  it("ilerleme oranı 0–1 arasında", () => {
    expect(referralRatio(0, 5)).toBe(0);
    expect(referralRatio(2, 5)).toBe(0.4);
    expect(referralRatio(7, 5)).toBe(1);
    expect(referralRatio(1, 0)).toBe(0);
  });
});
