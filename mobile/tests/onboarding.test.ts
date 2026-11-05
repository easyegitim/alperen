import { parseBirthYear } from "@/mobile/src/features/onboarding/age";
import { mapConsentRows } from "@/mobile/src/features/onboarding/consents";
import { canContinue, parseDraft, STEPS, toDraft, toPayload, type Draft } from "@/mobile/src/features/onboarding/questionnaireDraft";

const full: Draft = {
  goals: ["hair", "skin"], presentation: "male", hairType: "straight", hairLength: "short", beardPreference: "short", beardGrowth: "medium",
  skinType: "oily", budget: "medium", minutesPerDay: 10, glasses: false, headCovering: false,
  body: { heightCm: "175", weightKg: "88,5", activity: "low" }, jawHealth: [], note: "  sade stiller  ",
};

describe("anket taslağı (SPEC 9.2, mobil)", () => {
  it("her adımın devam koşulu dolu taslakta sağlanır; boş taslakta ilk adım engellenir", () => {
    for (const s of STEPS) expect(canContinue(s, full)).toBe(true);
    expect(canContinue("goals", {})).toBe(false);
    expect(canContinue("body", { bodySkipped: true })).toBe(true);
    expect(canContinue("note", { note: "x".repeat(301) })).toBe(false);
  });
  it("taslak şemaya çevrilir: virgüllü kilo, kırpılmış not, atlanan beden", () => {
    const p = toPayload(full);
    expect(p?.body).toEqual({ heightCm: 175, weightKg: 88.5, activity: "low" });
    expect(p?.note).toBe("sade stiller");
    expect(toPayload({ ...full, bodySkipped: true })?.body).toBeUndefined();
    expect(toPayload({ goals: [] })).toBeNull();
  });
  it("mevcut anket taslağa, bozuk kayıt boş taslağa döner", () => {
    const d = toDraft({ goals: ["skin"], body: { heightCm: 180, weightKg: 70, activity: "high" } } as never);
    expect(d.body).toEqual({ heightCm: "180", weightKg: "70", activity: "high" });
    expect(parseDraft("{bozuk")).toEqual({});
    expect(parseDraft(null)).toEqual({});
  });
});

describe("doğum yılı girişi", () => {
  it("4 hane ve aralık kontrolü", () => {
    expect(parseBirthYear("1990", 2026)).toBe(1990);
    expect(parseBirthYear(" 2026 ", 2026)).toBe(2026);
    expect(parseBirthYear("2027", 2026)).toBeNull();
    expect(parseBirthYear("199", 2026)).toBeNull();
    expect(parseBirthYear("1899", 2026)).toBeNull();
  });
});

describe("rıza durumu eşlemesi", () => {
  it("current_consents satırları ConsentState'e çevrilir", () => {
    const s = mapConsentRows([{ type: "biometric_processing", granted: true, text_version: "2026-10-09.1" }, { type: "marketing", granted: false, text_version: null }]);
    expect(s.biometric_processing).toEqual({ granted: true, textVersion: "2026-10-09.1" });
    expect(s.marketing?.granted).toBe(false);
    expect(mapConsentRows(null)).toEqual({});
  });
});
