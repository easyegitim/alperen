import { describe, expect, it } from "vitest";
import { DELETE_CONFIRM_WORD, isDeleteConfirmed, isManageableConsent, MANAGEABLE_CONSENTS, offersAnalysisDeletion, purgeDateFor, revokeEffects } from "@/lib/account/consents";
import { CONSENT_TYPES } from "@/lib/consent";

describe("hesap rıza yönetimi (SPEC 16.2 / Faz 13)", () => {
  it("yönetilebilir rızalar geçerli consent_type değerleridir; sözleşmesel onaylar listede değildir", () => {
    for (const k of MANAGEABLE_CONSENTS) expect(CONSENT_TYPES).toContain(k);
    expect(isManageableConsent("distance_sales_terms")).toBe(false);
    expect(isManageableConsent("instant_performance_waiver")).toBe(false);
    expect(isManageableConsent("kvkk_notice_ack")).toBe(false);
  });
  it("zorunlu analiz rızaları geri alınınca analiz ve deneme kapanır", () => {
    expect(revokeEffects("biometric_processing")).toContain("analysis_blocked");
    expect(revokeEffects("photo_ai_analysis")).toContain("tryon_blocked");
    expect(revokeEffects("cross_border_transfer")).toEqual(["analysis_blocked", "tryon_blocked", "expert_sharing_blocked"]);
    expect(revokeEffects("marketing")).toEqual(["marketing_stopped"]);
  });
  it("analiz silme sorusu yalnız biometric_processing geri alınırken sorulur", () => {
    expect(offersAnalysisDeletion("biometric_processing", false)).toBe(true);
    expect(offersAnalysisDeletion("biometric_processing", true)).toBe(false);
    expect(offersAnalysisDeletion("photo_ai_analysis", false)).toBe(false);
  });
  it("silme onayı Türkçe büyük İ ile tam eşleşir", () => {
    expect(DELETE_CONFIRM_WORD).toBe("SİL");
    expect(isDeleteConfirmed("SİL")).toBe(true);
    expect(isDeleteConfirmed("SIL")).toBe(false);
    expect(isDeleteConfirmed("sil")).toBe(false);
    expect(isDeleteConfirmed(" SİL")).toBe(false);
  });
  it("silme tarihi talebin 7 gün sonrasıdır", () => {
    expect(purgeDateFor("2026-10-12T10:00:00Z").toISOString()).toBe("2026-10-19T10:00:00.000Z");
  });
});
