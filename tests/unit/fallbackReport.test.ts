import { describe, expect, it } from "vitest";
import { buildFallbackReport, contourTips } from "@/content/fallback-report";
import { CoachReport } from "@/lib/ai/reportSchema";
import { scanReport } from "@/lib/ai/safety";
import { bodyRules } from "@/lib/coach/bodyRules";
import { allowedCatalog } from "@/lib/coach/catalog";
import { WEIGHT_CONTENT_RE } from "@/lib/coach/bodyRules";
import type { Questionnaire } from "@/lib/questionnaire";

const q: Questionnaire = {
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
const gains = { skin: { value: 1 }, hair: { value: 0.5 }, grooming: { value: 0.5 }, jawline: { value: 0.3 } };

function make(over: Partial<Questionnaire> = {}, bmi: number | null = null) {
  const qq = { ...q, ...over };
  const body = bodyRules({ bmi, note: qq.note });
  const catalog = allowedCatalog({ faceShape: "oval", questionnaire: qq, body });
  return buildFallbackReport({ overall: 6.1, potential: 7.2, faceShape: "oval", questionnaire: qq, catalog, body, flags: { visibleSkinConcern: false, skinConcernNote: null }, gains });
}

describe("fallback rapor (SPEC 9.7)", () => {
  it("şemaya uyar ve güvenlik filtresinden geçer", () => {
    const r = make();
    expect(CoachReport.safeParse(r).success).toBe(true);
    expect(scanReport(r, { faceContoursEnabled: false })).toEqual([]);
    expect(r.hair).toHaveLength(3);
  });
  it("VKİ < 25 → kalori/kilo içeriği yok; VKİ ≥ 25 → yüz hatları açık ve ≤ 500 kcal", () => {
    const normal = make({ body: { heightCm: 180, weightKg: 70, activity: "medium" } }, 21.6);
    expect(normal.faceContours.enabled).toBe(false);
    expect(WEIGHT_CONTENT_RE.test(JSON.stringify(normal))).toBe(false);
    const over = make({ body: { heightCm: 170, weightKg: 85, activity: "low" } }, 29.4);
    expect(over.faceContours.enabled).toBe(true);
    expect(scanReport(over, { faceContoursEnabled: true })).toEqual([]);
  });
  it("jawHealth işaretli → egzersiz yok; başörtüsü → saç ve renk yok; kadın → sakal yok", () => {
    expect(make({ jawHealth: ["clicking"] }).exercises).toEqual([]);
    const hc = make({ headCovering: true });
    expect(hc.hair).toEqual([]);
    expect(hc.hairColor).toBeNull();
    expect(make({ presentation: "female" }).beard).toEqual([]);
  });
  it("kısıtlama notu → kilo içeriği yok, nazik diyetisyen notu", () => {
    const r = make({ note: "en hızlı nasıl 10 kilo veririm", body: { heightCm: 170, weightKg: 90, activity: "low" } }, 31);
    expect(r.faceContours.enabled).toBe(false);
    expect(WEIGHT_CONTENT_RE.test(JSON.stringify(r.faceContours))).toBe(false);
    expect(r.seeProfessional?.specialty).toBe("diyetisyen");
    expect(r.seeProfessional?.text).toContain("olabilir");
  });
});

describe("contourTips (engine spec §9.6: yüz hatları kodla)", () => {
  it("yalnız deficit modunda dolu; fallback aynı diziyi kullanır", () => {
    expect(contourTips(bodyRules({ bmi: 22, note: undefined }))).toEqual([]);
    expect(contourTips(bodyRules({ bmi: null, note: undefined }))).toEqual([]);
    expect(contourTips(bodyRules({ bmi: 17, note: undefined }))).toEqual([]);
    expect(contourTips(bodyRules({ bmi: 28, note: "hızlı kilo vermek istiyorum" }))).toEqual([]);
    const deficit = bodyRules({ bmi: 28, note: undefined });
    const tips = contourTips(deficit);
    expect(tips).toHaveLength(4);
    expect(make({ body: { heightCm: 170, weightKg: 85, activity: "low" } }, 29.4).faceContours.tips).toEqual(tips);
  });
  it("VKİ ≥ 30 diyetisyen ipucunu ekler; her ipucu güvenlik filtresinden geçer ve ≤ 160 karakter", () => {
    const tips = contourTips(bodyRules({ bmi: 31, note: undefined }));
    expect(tips).toHaveLength(5);
    for (const t of tips) expect(t.length).toBeLessThanOrEqual(160);
    expect(scanReport({ faceContours: { enabled: true, tips } }, { faceContoursEnabled: true })).toEqual([]);
  });
});
