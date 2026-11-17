import { describe, expect, it } from "vitest";
import { REFERRAL_CODE_RE, generateReferralCode, normalizeReferralCode } from "@/lib/referral/code";
import { REFERRAL_INVITES_REQUIRED, checkClaim, referralProgress } from "@/lib/referral/unlock";

describe("davet kodu", () => {
  it("DV-XXXX-XXXX biçimi; karıştırılabilen karakter yok", () => {
    for (let i = 0; i < 50; i++) expect(generateReferralCode()).toMatch(REFERRAL_CODE_RE);
    expect(generateReferralCode(() => new Uint8Array(8).fill(0))).toBe("DV-AAAA-AAAA");
  });
  it("normalize: küçük harf, boşluk, tire toleransı; geçersizler null", () => {
    expect(normalizeReferralCode(" dv-ab2c-x9yz ")).toBe("DV-AB2C-X9YZ");
    expect(normalizeReferralCode("AB2CX9YZ")).toBe("DV-AB2C-X9YZ");
    expect(normalizeReferralCode("DV-0BCD-1EFG")).toBeNull(); // alfabede 0/1/O/I yok
    expect(normalizeReferralCode("DV-ABC")).toBeNull();
    expect(normalizeReferralCode("")).toBeNull();
  });
});

describe("davet kilidi (KB Ç12: 5 davet → yalnız genel skor)", () => {
  const at = "2026-11-04T00:00:00Z";
  it("yalnız fotoğraf yollamış davetliler sayılır; aynı davetli bir kez", () => {
    expect(REFERRAL_INVITES_REQUIRED).toBe(5);
    const rows = [
      { referee_id: "a", photo_submitted_at: at },
      { referee_id: "a", photo_submitted_at: at },
      { referee_id: "b", photo_submitted_at: null },
      { referee_id: "c", photo_submitted_at: at },
    ];
    expect(referralProgress(rows)).toEqual({ done: 2, total: 5, pending: 1, unlocked: false });
  });
  it("5 tamamlanınca açılır", () => {
    const rows = ["a", "b", "c", "d", "e"].map((id) => ({ referee_id: id, photo_submitted_at: at }));
    expect(referralProgress(rows).unlocked).toBe(true);
    expect(referralProgress(rows.slice(0, 4)).unlocked).toBe(false);
  });
  it("kabul: kendi kodu, ikinci davet ve bilinmeyen kod reddedilir", () => {
    expect(checkClaim({ referrerId: "u1", refereeId: "u1", alreadyReferred: false })).toEqual({ ok: false, reason: "self" });
    expect(checkClaim({ referrerId: "u1", refereeId: "u2", alreadyReferred: true })).toEqual({ ok: false, reason: "already_claimed" });
    expect(checkClaim({ referrerId: null, refereeId: "u2", alreadyReferred: false })).toEqual({ ok: false, reason: "unknown_code" });
    expect(checkClaim({ referrerId: "u1", refereeId: "u2", alreadyReferred: false })).toEqual({ ok: true });
  });
});
