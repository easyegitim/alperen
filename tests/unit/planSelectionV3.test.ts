import { describe, expect, it } from "vitest";
import { toAnthropicJsonSchema } from "@/lib/ai/anthropic";
import { buildPlanUserMessageV3, PLAN_V3_SYSTEM, recordForPrompt } from "@/lib/ai/prompts/report.v3";
import { PLAN_SELECTION_LIMITS, PlanSelectionOutput, normalizePlanSelection } from "@/lib/ai/reportSchema.v3";
import { CatalogKnowledgeSource } from "@/lib/coach/knowledge";
import { normalizeTr } from "@/lib/ai/safety";
import { FIXTURE_REPORT } from "@/tests/fixtures/analysisV2";

type Json = Record<string, unknown>;
function walk(node: unknown, visit: (n: Json) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (node && typeof node === "object") {
    visit(node as Json);
    Object.values(node).forEach((v) => walk(v, visit));
  }
}

describe("plan seçimi şeması ve istemi (PLAN 4e; CONTRACTS_V2 S2.1 kural 1; Sprint 1 gramer sınırı dersi)", () => {
  it("şema küçük ve düz: tek dizi, 4 zorunlu alan, enum'lar, min/max yok, ≤ 24 alan, < 4 KB", () => {
    const schema = toAnthropicJsonSchema(PlanSelectionOutput);
    const text = JSON.stringify(schema);
    expect(text.length).toBeLessThan(4000);
    let props = 0;
    walk(schema, (n) => {
      if (n.properties) props += Object.keys(n.properties as Json).length;
      for (const k of ["minimum", "maximum", "minLength", "maxLength", "maxItems", "pattern"]) expect(k in n, k).toBe(false);
      if (n.properties) expect(n.required).toEqual(Object.keys(n.properties as Json));
    });
    expect(props).toBeLessThanOrEqual(24);
    expect(text).toContain('"enum"');
    expect(text).not.toContain("anyOf");
  });

  it("normalize: tekrar eden kimlik düşer, tavan 16, gerekçe kırpılır", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `s${i % 20}`, phase: "weeks_0_4" as const, region: "skin" as const, rationale: "x".repeat(500) }));
    const out = normalizePlanSelection({ selections: many });
    expect(out.selections).toHaveLength(PLAN_SELECTION_LIMITS.selections);
    expect(new Set(out.selections.map((s) => s.id)).size).toBe(16);
    expect(out.selections[0]!.rationale.length).toBe(PLAN_SELECTION_LIMITS.rationale);
    expect(PlanSelectionOutput.safeParse({ selections: [{ id: "a", phase: "never", region: "skin", rationale: "" }] }).success).toBe(false);
  });

  it("istem: yalnız verilen kayıtlar (≤ 40, kompakt alanlar); skor, oran, boy/kilo, çene koşulu yok; kurallar Ek B dilinde", () => {
    const records = new CatalogKnowledgeSource().allRecords().slice(0, 40);
    const msg = buildPlanUserMessageV3({
      report: FIXTURE_REPORT,
      photoFacts: ["Saç uçları dağınık"],
      improveFirst: [{ stepId: "st_spf", step: "Günlük SPF" }],
      faceShape: { primary: "square", nameTr: "Kare", descriptionTr: "Çene hattı belirgin." },
      questionnaire: { goals: ["skin"], goalDirection: "sharper_mature", budget: "1000_2500", minutesPerDay: 10, sportDays: "2_3", work: "desk", hairLengthPref: "short", beardLengthPref: "stubble", skinType: "combination", glasses: false, headCovering: false },
      allowedAreas: ["skin", "hair"],
      records,
    });
    for (const r of records) expect(msg).toContain(`"id":"${r.id}"`);
    expect(msg).not.toMatch(/overall|potential|subscore|fwhr|jawRatio|heightCm|weightKg|bmi|bruxism|jaw_pain/i);
    expect(Object.keys(recordForPrompt(records[0]!)).sort()).toEqual(["area", "cost", "evidence", "id", "minutes", "per", "summary", "tags", "tier", "title"]);
    const sys = normalizeTr(PLAN_V3_SYSTEM);
    for (const term of ["botoks", "dolgu", "mewing", "ac kalma", "steroid", "hormon", "kalori"]) expect(sys).toContain(term); // yasak listesi olarak
    expect(sys).toContain("yalnız verilen listedeki".replace("ı", "i")); // kimlik kuralı
    expect(sys).toContain("rakam");
  });
});
