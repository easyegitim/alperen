import { describe, expect, it } from "vitest";
import { BASIS_CHIP_KEYS } from "@/lib/coach/planTypes";
import { areasForContext, basisChipsV2, bmiOf, bodyAllowanceV2, constraintsFromContext, exclusionsV2 } from "@/lib/coach/planBasisV2";
import { QuestionnaireV2Schema, emptyQuestionnaireV2, hairAdviceAllowedV2 } from "@/lib/questionnaireV2";
import { fixturePlanContext } from "@/tests/fixtures/planV2";

describe("planBasisV2 (PLAN §3 kişiselleştirme listesi; KB §3.2/5, K8–K10, Ç1, Ç17)", () => {
  it("her anket cevabı ve fotoğraf gerçeği çip olarak görünür; boy, kilo ve VKİ asla", () => {
    const ctx = fixturePlanContext();
    const chips = basisChipsV2(ctx);
    const keys = chips.map((c) => c.key);
    for (const k of ["goal", "goalDirection", "budget", "oneTimeBudget", "minutes", "sportDays", "work", "hairLength", "beardLength", "skinType", "glasses", "headCovering", "faceShape", "ageBand", "presentation", "photoFact", "viewsUsed"]) {
      expect(keys, k).toContain(k);
    }
    expect(chips.filter((c) => c.key === "goal")).toHaveLength(2);
    expect(chips.filter((c) => c.key === "photoFact")).toHaveLength(2);
    expect(chips.find((c) => c.key === "viewsUsed")?.value).toBe("3");
    // gözlük fotoğraftan (value null) → kaynak photo; başörtüsü kullanıcı cevabı → questionnaire
    expect(chips.find((c) => c.key === "glasses")).toMatchObject({ value: "no", source: "photo" });
    expect(chips.find((c) => c.key === "headCovering")).toMatchObject({ value: "no", source: "questionnaire" });
    expect(chips.find((c) => c.key === "faceShape")).toMatchObject({ value: "square", source: "photo" });
    expect(JSON.stringify(chips)).not.toMatch(/178|82|bmi|vki|heightCm|weightKg/i);
    for (const c of chips) expect(BASIS_CHIP_KEYS).toContain(c.key);
    expect(chips.length).toBeLessThanOrEqual(30);
  });

  it("çene sağlığı: koşul listelenmez, yalnız tek genel çip; jawHealth boşsa çip yok", () => {
    const base = fixturePlanContext();
    expect(basisChipsV2(base).some((c) => c.key === "jawHealth")).toBe(false);
    const issue = fixturePlanContext({ questionnaire: { ...base.questionnaire, jawHealth: ["jaw_pain", "clicking"] } });
    const chips = basisChipsV2(issue).filter((c) => c.key === "jawHealth");
    expect(chips).toHaveLength(1);
    expect(chips[0]!.value).toBeUndefined();
    expect(JSON.stringify(basisChipsV2(issue))).not.toMatch(/jaw_pain|clicking/);
  });

  it("kısıtlar ve alanlar anketten türer; kadın sunumunda sakal yok; başörtüsüyle saç/renk yok", () => {
    const ctx = fixturePlanContext();
    const c = constraintsFromContext(ctx);
    expect(c).toMatchObject({ headCovering: false, presentation: "male", jawHealth: "none", beardPreference: "some", budgetBand: "1000_2500", timeBand: 10, under18: false, bodyFatAllowed: true, glasses: false, doctorLayer: false });
    expect(areasForContext(ctx)).toEqual(["hair", "color", "beard", "skin", "brows", "habit", "style", "exercise"]);
    const female = fixturePlanContext({ presentation: "female" });
    expect(areasForContext(female)).not.toContain("beard");
    const covered = fixturePlanContext({ questionnaire: { ...ctx.questionnaire, headCovering: { detected: true, value: true } } });
    expect(areasForContext(covered)).not.toContain("hair");
    expect(areasForContext(covered)).not.toContain("color");
    expect(constraintsFromContext(covered).headCovering).toBe(true);
    expect(hairAdviceAllowedV2(covered.questionnaire)).toBe(false);
  });

  it("K8: VKİ ve yaş bandı yağ oranı iznini belirler; exclusion nedeni görünür", () => {
    expect(bmiOf({ heightCm: 178, weightKg: 82 })).toBe(25.9);
    expect(bmiOf(undefined)).toBeNull();
    expect(bodyAllowanceV2(fixturePlanContext()).bodyFatAllowed).toBe(true);
    expect(bodyAllowanceV2(fixturePlanContext({ ageBand: "under_18" }))).toMatchObject({ bodyFatAllowed: false, exclusion: "under_18" });
    const lean = fixturePlanContext({ questionnaire: { ...fixturePlanContext().questionnaire, body: { heightCm: 180, weightKg: 65 } } });
    expect(bodyAllowanceV2(lean)).toMatchObject({ bodyFatAllowed: false, exclusion: "bmi_below_25" });
    expect(exclusionsV2(lean).bodyFat).toBe("bmi_below_25");
    expect(exclusionsV2(fixturePlanContext()).bodyFat).toBeUndefined();
  });

  it("anket varsayılanları: tahmin yoksa başörtüsü bilinmiyor → saç önerisi yok; şema skor alanı kabul etmez", () => {
    const q = emptyQuestionnaireV2();
    expect(q.headCovering).toEqual({ detected: null, value: null });
    expect(hairAdviceAllowedV2(q)).toBe(false);
    const pre = emptyQuestionnaireV2({ headCoveringDetected: false, glassesDetected: true });
    expect(hairAdviceAllowedV2(pre)).toBe(true);
    expect(pre.glasses).toEqual({ detected: true, value: null });
    expect(QuestionnaireV2Schema.safeParse(pre).success).toBe(true);
    expect(QuestionnaireV2Schema.safeParse({ ...pre, overall: 7 }).success).toBe(true); // bilinmeyen anahtar atılır
    expect(Object.keys(QuestionnaireV2Schema.parse({ ...pre, overall: 7 }))).not.toContain("overall");
    expect(QuestionnaireV2Schema.safeParse({ ...pre, minutesPerDay: 15 }).success).toBe(false);
    expect(QuestionnaireV2Schema.safeParse({ ...pre, body: { heightCm: 90, weightKg: 70 } }).success).toBe(false);
  });
});
