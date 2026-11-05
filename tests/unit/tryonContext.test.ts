import { describe, expect, it } from "vitest";
import { buildPriorityTable, groupLayers, groupPhases, type PlanV2, type StepCard } from "@/lib/coach/planTypes";
import { tryonPresentation, tryonRecommended } from "@/lib/tryon/context";

// /dene bağlamı web sayfası ve GET /api/tryon/status (mobil) için tek kural. Canlı duman testinde status v1 anketinden
// sunum ("unspecified") ve v1 rapordan öneri ([]) okuyordu; v2 kullanıcısının profili ve plan_v2'si yok sayılıyordu.

const step = (over: Partial<StepCard> = {}): StepCard => ({
  id: "stubble_heavy",
  area: "beard",
  phase: "weeks_0_4",
  tier: "expert",
  title: "Belirgin kirli sakal",
  observationRef: { region: "beard", observation: "Kirli sakal eşit" },
  costTryRange: { min: 0, max: 500 },
  frequency: { per: "once", times: 1 },
  minutesPerDay: 0,
  difficulty: 1,
  impact: 2,
  effort: 1,
  evidence: { level: "expert_opinion" },
  tryonPresetId: "stubble_heavy",
  ...over,
});

function plan(steps: StepCard[]): PlanV2 {
  return {
    version: "plan.v2",
    phases: groupPhases(steps),
    steps,
    priorityTable: buildPriorityTable(steps),
    basisChips: [{ key: "goal", value: "hair", source: "questionnaire" }],
    layers: groupLayers(steps),
    exclusions: {},
    disclaimers: ["notMedicalAdvice", "aiGenerated"],
    meta: { analysisId: "11111111-1111-4111-8111-111111111111", generatedAt: "2026-11-05T10:00:00Z", model: "claude-opus-5-5", promptVersion: "plan.v2", knowledgeSource: "catalog", retrievedIds: ["stubble_heavy"], droppedUnknownIds: 0 },
  };
}

describe("tryonRecommended", () => {
  it("plan v2 adımlarının deneme kimlikleri (tekrarsız); v3 rapor metni öneri üretmez", () => {
    const p = plan([step(), step({ id: "side_part_fade", area: "hair", title: "Fade'li yan ayrım", tryonPresetId: "side_part_fade" }), step({ id: "st_spf", area: "skin", tier: "diy", tryonPresetId: undefined })]);
    expect(tryonRecommended(p, { version: "report.v3", letter: "…" })).toEqual(["stubble_heavy", "side_part_fade"]);
  });
  it("plan yoksa ya da bozuksa boş; asla fırlatmaz", () => {
    expect(tryonRecommended(null, null)).toEqual([]);
    expect(tryonRecommended({ version: "plan.v2" }, "x")).toEqual([]);
  });
});

describe("tryonPresentation", () => {
  it("profiles.presentation önce; yoksa eski anket; o da yoksa unspecified", () => {
    expect(tryonPresentation({ presentation: "male", questionnaire: null })).toBe("male");
    expect(tryonPresentation({ presentation: "bogus" })).toBe("unspecified");
    expect(tryonPresentation(null)).toBe("unspecified");
  });
});
