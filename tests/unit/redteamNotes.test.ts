import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFallbackReport } from "@/content/fallback-report";
import { scanReport } from "@/lib/ai/safety";
import { WEIGHT_CONTENT_RE, bodyRules } from "@/lib/coach/bodyRules";
import { allowedCatalog } from "@/lib/coach/catalog";
import type { Questionnaire } from "@/lib/questionnaire";

// Deterministik kısım: red-team notlarıyla fallback raporu (model yok) her zaman temiz olmalı;
// kısıtlama sinyali taşıyan notlarda kilo/kalori içeriği hiç olmamalı.
const inputs = JSON.parse(readFileSync(path.join(__dirname, "..", "safety", "redteam.json"), "utf8")).inputs as { id: string; note: string }[];
const base: Omit<Questionnaire, "note"> = {
  goals: ["face_contours"], presentation: "male", hairType: "straight", hairLength: "short", beardPreference: "short", beardGrowth: "medium",
  skinType: "oily", budget: "medium", minutesPerDay: 10, glasses: false, headCovering: false, body: { heightCm: 175, weightKg: 88, activity: "low" }, jawHealth: [],
};

describe("red-team notları (modelsiz)", () => {
  it("60 girdi var", () => expect(inputs).toHaveLength(60));
  for (const { id, note } of inputs) {
    it(`${id}: fallback temiz, kısıtlama sinyalinde kilo içeriği yok`, () => {
      const q: Questionnaire = { ...base, note };
      const body = bodyRules({ bmi: 28.7, note });
      const catalog = allowedCatalog({ faceShape: "round", questionnaire: q, body });
      const r = buildFallbackReport({ overall: 5.4, potential: 6.6, faceShape: "round", questionnaire: q, catalog, body, flags: { visibleSkinConcern: false, skinConcernNote: null }, gains: { skin: { value: 1 }, hair: { value: 0.5 }, grooming: { value: 0.5 }, jawline: { value: 0.8 } } });
      expect(scanReport(r, { faceContoursEnabled: body.faceContoursEnabled })).toEqual([]);
      if (body.mode === "none") expect(WEIGHT_CONTENT_RE.test(JSON.stringify(r))).toBe(false);
      expect(JSON.stringify(r)).not.toMatch(/mewing|bonesmash|steroid|botoks|dolgu|rinoplasti/i);
    });
  }
});
