import { describe, expect, it } from "vitest";
import { buildPriorityTable, groupLayers, groupPhases, type PlanV2, type StepCard } from "@/lib/coach/planTypes";
import { routineItemsFromPlanV2 } from "@/lib/routine/fromReport";

// Canlı duman testi: rutin boş ekranı "Planımdan rutin oluştur" → /plan; plan v2 ekranında rutine ekleme yoktu (çıkmaz).
// Plan v2 adım kimlikleri katalog kimlikleridir (st_*, ex_*, hb_*); yalnız bunlar rutine girer.

const step = (over: Partial<StepCard>): StepCard => ({
  id: "st_spf",
  area: "skin",
  phase: "weeks_0_4",
  tier: "diy",
  title: "Güneş koruyucu SPF 30+",
  observationRef: { region: "skin" },
  costTryRange: { min: 0, max: 500 },
  frequency: { per: "day", times: 1 },
  minutesPerDay: 1,
  difficulty: 1,
  impact: 2,
  effort: 1,
  evidence: { level: "expert_opinion" },
  ...over,
});

function plan(steps: StepCard[]): PlanV2 {
  return {
    version: "plan.v2",
    phases: groupPhases(steps),
    steps,
    priorityTable: buildPriorityTable(steps),
    basisChips: [{ key: "goal", value: "skin", source: "questionnaire" }],
    layers: groupLayers(steps),
    exclusions: {},
    disclaimers: ["notMedicalAdvice", "aiGenerated"],
    meta: { analysisId: "11111111-1111-4111-8111-111111111111", generatedAt: "2026-11-05T10:00:00Z", model: "claude-opus-5-5", promptVersion: "plan.v2", knowledgeSource: "catalog", retrievedIds: [], droppedUnknownIds: 0 },
  };
}

describe("routineItemsFromPlanV2", () => {
  const p = plan([
    step({ id: "st_clay_mask_weekly", title: "Haftalık kil maskesi", impact: 1, effort: 2 }),
    step({ id: "st_spf", impact: 3, effort: 1 }),
    step({ id: "stubble_heavy", area: "beard", tier: "expert", title: "Belirgin kirli sakal", observationRef: { region: "beard" }, tryonPresetId: "stubble_heavy" }),
    step({ id: "hb_hair_wash_rhythm", area: "habit", title: "Saç yıkama düzeni", observationRef: { region: "hair" } }),
    step({ id: "ex_chin_tuck", area: "exercise", title: "Çene geri çekme (postür)", observationRef: { region: "skin" } }),
  ]);

  it("katalog kimlikli adımlar türü ve katalog slotuyla, öncelik sırasıyla; stil/berber adımı girmez", () => {
    const items = routineItemsFromPlanV2(p, "u1");
    expect(items.map((i) => [i.kind, i.ref_id, i.slot])).toEqual([
      ["step", "st_spf", "morning"],
      ["habit", "hb_hair_wash_rhythm", "daily"],
      ["exercise", "ex_chin_tuck", "daily"],
      ["step", "st_clay_mask_weekly", "weekly"],
    ]);
    expect(items.every((i) => i.user_id === "u1")).toBe(true);
    expect(items.map((i) => i.position)).toEqual([0, 1, 2, 3]);
    expect(items.find((i) => i.ref_id === "hb_hair_wash_rhythm")?.title).toMatch(/^Saç yıkama/);
  });

  it("doktor katmanı ve bilinmeyen kimlik rutine girmez", () => {
    const items = routineItemsFromPlanV2(plan([step({ id: "unknown_x" }), step({ id: "st_spf", tier: "doctor" })]), "u1");
    expect(items).toEqual([]);
  });
});
