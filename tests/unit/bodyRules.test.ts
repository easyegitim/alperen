import { describe, expect, it } from "vitest";
import { bodyRules, hasRestrictionSignal } from "@/lib/coach/bodyRules";

describe("bodyRules (SPEC 9.4, D10)", () => {
  it("VKİ ≥ 25 → yüz hatları açık; ≥ 30 diyetisyen", () => {
    expect(bodyRules({ bmi: 25 })).toMatchObject({ mode: "deficit", faceContoursEnabled: true, dietitianSuggested: false });
    expect(bodyRules({ bmi: 30 })).toMatchObject({ mode: "deficit", dietitianSuggested: true });
  });
  it("18,5 ≤ VKİ < 25 → kilo verme yok, yalnız şişlik", () => {
    expect(bodyRules({ bmi: 24.9 })).toMatchObject({ mode: "debloat", faceContoursEnabled: false });
    expect(bodyRules({ bmi: 18.5 })).toMatchObject({ mode: "debloat" });
  });
  it("VKİ < 18,5 → kilo içeriği yok, nazik not", () => {
    expect(bodyRules({ bmi: 18.4 })).toMatchObject({ mode: "none", faceContoursEnabled: false, gentleProfessionalNote: true });
  });
  it("boy/kilo yoksa unknown", () => {
    expect(bodyRules({ bmi: null })).toMatchObject({ mode: "unknown", faceContoursEnabled: false });
  });
  it("notta kısıtlama/hızlı kilo sinyali VKİ'den bağımsız 'none'", () => {
    for (const note of ["en hızlı nasıl 10 kilo veririm", "aç kalarak zayıflamak istiyorum", "öğün atlıyorum", "detoks çayı önerir misin", "günde 500 kalori yiyorum"]) {
      expect(hasRestrictionSignal(note)).toBe(true);
      expect(bodyRules({ bmi: 28, note })).toMatchObject({ mode: "none", gentleProfessionalNote: true });
    }
    expect(hasRestrictionSignal("kurumsal işte çalışıyorum, sade stiller")).toBe(false);
  });
});
