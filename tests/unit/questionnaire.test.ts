import { describe, expect, it } from "vitest";
import { QuestionnaireSchema, deriveContext } from "@/lib/questionnaire";

const base = {
  goals: ["hair", "skin"],
  presentation: "male",
  hairType: "wavy",
  hairLength: "short",
  beardPreference: "stubble",
  beardGrowth: "medium",
  skinType: "combination",
  budget: "medium",
  minutesPerDay: 10,
  glasses: false,
  headCovering: false,
  jawHealth: [],
};

describe("QuestionnaireSchema (SPEC 9.2)", () => {
  it("geçerli anketi kabul eder, body isteğe bağlı", () => {
    expect(QuestionnaireSchema.safeParse(base).success).toBe(true);
    expect(QuestionnaireSchema.safeParse({ ...base, body: { heightCm: 180, weightKg: 82, activity: "medium" } }).success).toBe(true);
  });
  it("en az bir hedef ister", () => {
    expect(QuestionnaireSchema.safeParse({ ...base, goals: [] }).success).toBe(false);
  });
  it("minutesPerDay yalnız 5/10/20", () => {
    expect(QuestionnaireSchema.safeParse({ ...base, minutesPerDay: 15 }).success).toBe(false);
  });
  it("not 300 karakteri aşamaz", () => {
    expect(QuestionnaireSchema.safeParse({ ...base, note: "a".repeat(301) }).success).toBe(false);
    expect(QuestionnaireSchema.safeParse({ ...base, note: "a".repeat(300) }).success).toBe(true);
  });
  it("boy/kilo sınırları", () => {
    expect(QuestionnaireSchema.safeParse({ ...base, body: { heightCm: 90, weightKg: 70, activity: "low" } }).success).toBe(false);
    expect(QuestionnaireSchema.safeParse({ ...base, body: { heightCm: 170, weightKg: 20, activity: "low" } }).success).toBe(false);
  });
});

describe("deriveContext (SPEC 9.2 / 9.4 / D10)", () => {
  it("boy/kilo yoksa VKİ yok ve yağ oranı bağlamı kapalı", () => {
    expect(deriveContext({ jawHealth: [] })).toEqual({ bmi: null, bodyFatContextAllowed: false, exerciseEligible: true });
  });
  it("VKİ ≥ 25 ise yağ oranı bağlamı açık", () => {
    const c = deriveContext({ body: { heightCm: 175, weightKg: 80, activity: "low" }, jawHealth: [] });
    expect(c.bmi).toBe(26.1);
    expect(c.bodyFatContextAllowed).toBe(true);
  });
  it("VKİ < 25 ise kapalı", () => {
    expect(deriveContext({ body: { heightCm: 180, weightKg: 70, activity: "high" }, jawHealth: [] }).bodyFatContextAllowed).toBe(false);
  });
  it("çene sağlığı sorunu varsa egzersiz uygun değil (D08)", () => {
    expect(deriveContext({ jawHealth: ["clicking"] }).exerciseEligible).toBe(false);
  });
});
