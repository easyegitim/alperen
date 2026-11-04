import { describe, expect, it } from "vitest";
import { decideAccess } from "@/lib/score/engine/access";

// AccessV2 (CONTRACTS_V2 §2.3, §3.4): hak yalnız sunucu satırlarından; davet kilidi ve yüzdelik bayrakla.

const paid = (id: string, analysis_id: string | null, product = "one_time_report") => ({ id, product, analysis_id, status: "paid" });

describe("decideAccess", () => {
  it("hiçbir şey yok → kilitli; bayraklar kapalı", () => {
    expect(decideAccess({ subscriptionActive: false, purchases: [], analysisId: "a1", referralsCompleted: 10, env: {} })).toEqual({ entitled: false, referralUnlock: false, percentile: false, subscriptionActive: false, unconsumedOneTimeId: null });
  });
  it("abonelik → entitled, tek seferlik tüketilmez", () => {
    expect(decideAccess({ subscriptionActive: true, purchases: [paid("p1", null)], analysisId: "a1", referralsCompleted: 0, env: {} })).toMatchObject({ entitled: true, subscriptionActive: true, unconsumedOneTimeId: null });
  });
  it("bu analize bağlı ödenmiş rapor → entitled; başka analize bağlı rapor → değil; bağlanmamış → entitled DEĞİL ama tüketilecek id", () => {
    expect(decideAccess({ subscriptionActive: false, purchases: [paid("p1", "a1")], analysisId: "a1", referralsCompleted: 0, env: {} }).entitled).toBe(true);
    expect(decideAccess({ subscriptionActive: false, purchases: [paid("p1", "a9")], analysisId: "a1", referralsCompleted: 0, env: {} }).entitled).toBe(false);
    // Bağlanmamış satın alma eski satırları açmaz (bir satın alma = bir rapor); yalnız bağlanacak kimlik olarak döner.
    expect(decideAccess({ subscriptionActive: false, purchases: [paid("p1", "a9"), paid("p2", null)], analysisId: "a1", referralsCompleted: 0, env: {} })).toMatchObject({ entitled: false, unconsumedOneTimeId: "p2" });
    expect(decideAccess({ subscriptionActive: false, purchases: [paid("p1", null, "weekly")], analysisId: "a1", referralsCompleted: 0, env: {} }).entitled).toBe(false);
  });
  it("davet kilidi yalnız FEATURE_REFERRAL_UNLOCK=true ve ≥ 5 davetle; yüzdelik yalnız FEATURE_PERCENTILE=true", () => {
    const env = { FEATURE_REFERRAL_UNLOCK: "true", FEATURE_PERCENTILE: "true" };
    expect(decideAccess({ subscriptionActive: false, purchases: [], analysisId: null, referralsCompleted: 5, env })).toMatchObject({ entitled: false, referralUnlock: true, percentile: true });
    expect(decideAccess({ subscriptionActive: false, purchases: [], analysisId: null, referralsCompleted: 4, env }).referralUnlock).toBe(false);
    expect(decideAccess({ subscriptionActive: false, purchases: [], analysisId: null, referralsCompleted: 5, env: { FEATURE_PERCENTILE: "yes" } })).toMatchObject({ referralUnlock: false, percentile: false });
  });
});
