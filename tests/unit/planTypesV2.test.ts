import { describe, expect, it } from "vitest";
import {
  BASIS_CHIP_KEYS,
  PERCEPTION_AREAS,
  PlanV2,
  STRUCTURAL_REGIONS,
  StepCard,
  buildPriorityTable,
  groupLayers,
  groupPhases,
  planIssues,
  type PlanV2 as PlanV2Type,
  type StepCard as StepCardType,
} from "@/lib/coach/planTypes";
import { EVIDENCE_FROM_GRADE, PLAN_AREAS, PLAN_PHASES, PLAN_TIERS, priorityScore } from "@/lib/config/plan";
import { QuestionnaireV2Schema, emptyQuestionnaireV2, exerciseEligibleV2, hairAdviceAllowedV2, resolvePhotoConfirm } from "@/lib/questionnaireV2";

const step = (over: Partial<StepCardType> = {}): StepCardType => ({
  id: "st_spf",
  area: "skin",
  phase: "weeks_0_4",
  tier: "diy",
  title: "Güneş koruyucu SPF 30+",
  observationRef: { region: "skin", observation: "Yanaklarda hafif ton farkı" },
  costTryRange: { min: 0, max: 500 },
  frequency: { per: "day", times: 1 },
  minutesPerDay: 1,
  difficulty: 1,
  impact: 3,
  effort: 1,
  evidence: { level: "many_studies", source: "https://doi.org/10.7326/M13-0035" },
  ...over,
});

function plan(steps: StepCardType[], over: Partial<PlanV2Type> = {}): PlanV2Type {
  return {
    version: "plan.v2",
    phases: groupPhases(steps),
    steps,
    priorityTable: buildPriorityTable(steps),
    basisChips: [{ key: "goal", value: "skin", source: "questionnaire" }],
    layers: groupLayers(steps),
    exclusions: {},
    disclaimers: ["notMedicalAdvice", "aiGenerated"],
    meta: { analysisId: "11111111-1111-4111-8111-111111111111", generatedAt: "2026-11-04T10:00:00Z", model: "claude-opus-5-5", promptVersion: "plan.v2", knowledgeSource: "catalog", retrievedIds: ["st_spf"], droppedUnknownIds: 0 },
    ...over,
  };
}

describe("PlanV2 (CONTRACTS_V2 Sprint 2; KB §6.1–6.2)", () => {
  it("sözlükler KB ile birebir: fazlar, katmanlar, alanlar, kanıt eşlemesi", () => {
    expect(PLAN_PHASES).toEqual(["weeks_0_4", "months_1_3", "months_3_6"]);
    expect(PLAN_TIERS).toEqual(["diy", "expert", "doctor"]);
    expect(PLAN_AREAS).toContain("brows");
    expect(EVIDENCE_FROM_GRADE).toEqual({ A: "many_studies", B: "limited_studies", C: "expert_opinion" });
    expect(BASIS_CHIP_KEYS).toContain("photoFact");
    expect(BASIS_CHIP_KEYS).not.toContain("bmi");
  });

  it("geçerli plan şemadan geçer; öncelik tablosu etki/emek azalan, eşitlikte az emek önce", () => {
    const steps = [step(), step({ id: "lv_haircut_refresh", area: "hair", tier: "expert", observationRef: { region: "hair" }, impact: 2, effort: 2, frequency: { per: "once", times: 1 }, minutesPerDay: 0 }), step({ id: "hb_sleep", area: "habit", impact: 2, effort: 1, costTryRange: { min: 0, max: 0 } })];
    const p = plan(steps);
    expect(PlanV2.safeParse(p).success).toBe(true);
    expect(p.priorityTable.map((r) => r.stepId)).toEqual(["st_spf", "hb_sleep", "lv_haircut_refresh"]);
    expect(p.priorityTable[0]!.score).toBe(priorityScore(3, 1));
    expect(p.layers).toEqual({ diy: ["st_spf", "hb_sleep"], expert: ["lv_haircut_refresh"], doctor: [] });
  });

  it("yapısal bölgeye bağlı adım yalnız algı/stil (perceptionOnly); cilt adımı çene hattına bağlanamaz", () => {
    expect(STRUCTURAL_REGIONS).toEqual(["eyeArea", "nose", "cheeks", "jawline"]);
    expect(PERCEPTION_AREAS).not.toContain("skin");
    const bad = plan([step({ observationRef: { region: "jawline" } })]);
    expect(planIssues(bad)).toContain("structural_region_needs_perception_step:st_spf");
    expect(PlanV2.safeParse(bad).success).toBe(false);
    const ok = plan([step({ id: "short_boxed", area: "beard", tier: "expert", observationRef: { region: "jawline" }, perceptionOnly: true, tryonPresetId: "short_boxed", frequency: { per: "once", times: 1 }, minutesPerDay: 0 })]);
    expect(planIssues(ok)).toEqual([]);
  });

  it("doktor katmanı adımı plana yazılamaz; layers.doctor her zaman boş", () => {
    const p = plan([step({ id: "m_doc_1", tier: "doctor" })]);
    expect(planIssues(p)).toContain("doctor_step_in_plan:m_doc_1");
    const q = plan([step()], { layers: { diy: ["st_spf"], expert: [], doctor: ["x"] } });
    expect(PlanV2.safeParse(q).success).toBe(false);
  });

  it("tutarlılık: faz/katman/öncelik bilinmeyen kimlik, tekrar, kayıp uyarı", () => {
    const s = step();
    expect(planIssues(plan([s], { phases: { weeks_0_4: ["st_spf", "ghost"], months_1_3: [], months_3_6: [] } }))).toContain("phase_unknown_step:ghost");
    expect(planIssues(plan([s, s]))).toContain("duplicate_step_id");
    expect(planIssues(plan([s], { priorityTable: [{ stepId: "st_spf", impact: 1, effort: 1, score: 9 }] }))).toContain("priority_score_mismatch:st_spf");
    expect(planIssues(plan([s], { disclaimers: ["aiGenerated"] }))).toContain("missing_not_medical_advice");
    expect(planIssues(plan([s], { phases: { weeks_0_4: [], months_1_3: ["st_spf"], months_3_6: [] } }))).toContain("step_phase_mismatch:st_spf");
  });

  it("StepCard sınırları: maliyet aralığı ters olamaz; zorluk/etki/emek 1–3; skor alanı yok", () => {
    expect(StepCard.safeParse(step({ costTryRange: { min: 500, max: 100 } })).success).toBe(false);
    expect(StepCard.safeParse({ ...step(), impact: 4 }).success).toBe(false);
    expect(Object.keys(StepCard.shape)).not.toContain("score");
    expect(Object.keys(StepCard.shape)).not.toContain("gain");
  });
});

describe("QuestionnaireV2 (KB §3.2/5–6, Ç17)", () => {
  it("varsayılan form şemadan geçer; sunum ve skor alanı yok; boy/kilo isteğe bağlı", () => {
    const q = emptyQuestionnaireV2({ glassesDetected: true, headCoveringDetected: false });
    expect(QuestionnaireV2Schema.safeParse(q).success).toBe(true);
    expect("presentation" in q).toBe(false);
    expect(q.body).toBeUndefined();
    expect(QuestionnaireV2Schema.safeParse({ ...q, body: { heightCm: 180, weightKg: 80 } }).success).toBe(true);
    expect(QuestionnaireV2Schema.safeParse({ ...q, minutesPerDay: 15 }).success).toBe(false);
    expect(QuestionnaireV2Schema.safeParse({ ...q, budget: "low" }).success).toBe(false);
  });

  it("Ç17: tahmin yoksa ve seçim yoksa saç önerisi üretilmez; kullanıcı cevabı tahmini ezer", () => {
    expect(resolvePhotoConfirm({ detected: null, value: null })).toBeNull();
    expect(resolvePhotoConfirm({ detected: true, value: null })).toBe(true);
    expect(resolvePhotoConfirm({ detected: true, value: false })).toBe(false);
    expect(hairAdviceAllowedV2({ headCovering: { detected: null, value: null } })).toBe(false);
    expect(hairAdviceAllowedV2({ headCovering: { detected: false, value: null } })).toBe(true);
    expect(hairAdviceAllowedV2({ headCovering: { detected: false, value: true } })).toBe(false);
    expect(exerciseEligibleV2({ jawHealth: [] })).toBe(true);
    expect(exerciseEligibleV2({ jawHealth: ["bruxism"] })).toBe(false);
  });
});
