import { describe, expect, it } from "vitest";
import { DEFAULT_ON_FLAGS, FLAGS, isFeatureEnabled, type FlagKey } from "@/lib/config/flags";

describe("isFeatureEnabled", () => {
  it("tanımsız veya false → kapalı (Uzman Ağı varsayılan kapalı, SPEC 12.2)", () => {
    expect(isFeatureEnabled("expertNetwork", {})).toBe(false);
    expect(isFeatureEnabled("expertNetwork", { FEATURE_EXPERT_NETWORK: "false" })).toBe(false);
    expect(isFeatureEnabled("weekPass", { FEATURE_WEEK_PASS: "1" })).toBe(false);
  });
  it("yalnız 'true' açar (büyük/küçük harf ve boşluk toleranslı)", () => {
    expect(isFeatureEnabled("expertNetwork", { FEATURE_EXPERT_NETWORK: "true" })).toBe(true);
    expect(isFeatureEnabled("weekPass", { FEATURE_WEEK_PASS: " TRUE " })).toBe(true);
  });
  it("v2 bayrakları (CONTRACTS_V2 §6): env adları sabit; hepsi varsayılan kapalı; yalnız 'true' açar", () => {
    const v2: Record<string, string> = {
      under18: "FEATURE_UNDER_18",
      percentile: "FEATURE_PERCENTILE",
      doctorLayer: "FEATURE_DOCTOR_LAYER",
      referralUnlock: "FEATURE_REFERRAL_UNLOCK",
      yearlyPlan: "FEATURE_YEARLY_PLAN",
    };
    for (const [key, envName] of Object.entries(v2)) {
      const k = key as FlagKey;
      expect(FLAGS[k]).toBe(envName);
      expect(isFeatureEnabled(k, {})).toBe(false);
      expect(isFeatureEnabled(k, { [envName]: "1" })).toBe(false);
      expect(isFeatureEnabled(k, { [envName]: "true" })).toBe(true);
    }
  });
  it("Sprint 2 bayrakları: FEATURE_PRODUCT_LINKS kapalı; FEATURE_GLOW_UP ve FEATURE_TRYON_COMBO açık başlar, yalnız 'false' kapatır", () => {
    expect(FLAGS.productLinks).toBe("FEATURE_PRODUCT_LINKS");
    expect(FLAGS.glowUp).toBe("FEATURE_GLOW_UP");
    expect(FLAGS.tryonCombo).toBe("FEATURE_TRYON_COMBO");
    expect(FLAGS.doctorLayer).toBe("FEATURE_DOCTOR_LAYER");
    expect(isFeatureEnabled("productLinks", {})).toBe(false);
    expect(isFeatureEnabled("productLinks", { FEATURE_PRODUCT_LINKS: "true" })).toBe(true);
    expect(DEFAULT_ON_FLAGS).toEqual(["glowUp", "tryonCombo"]);
    for (const k of DEFAULT_ON_FLAGS) {
      expect(isFeatureEnabled(k, {})).toBe(true);
      expect(isFeatureEnabled(k, { [FLAGS[k]]: "true" })).toBe(true);
      expect(isFeatureEnabled(k, { [FLAGS[k]]: " FALSE " })).toBe(false);
      expect(isFeatureEnabled(k, { [FLAGS[k]]: "0" })).toBe(true);
    }
    // doktor katmanı her zaman kapalı başlar (KB Ç3)
    expect(isFeatureEnabled("doctorLayer", {})).toBe(false);
  });
});
