import { fixturePlanView } from "@/tests/fixtures/planV2";
import { emptyQuestionnaireV2 } from "@/lib/questionnaireV2";
import { STEPS_V2, canContinueV2, initialDraftV2, loadDraftV2, progressPct, saveDraftV2, toPayloadV2 } from "@/mobile/src/features/plan/questionnaireDraft";
import { costLabel, exclusionEntries, hairLossOf, hasScalpStepIn, isHttpsUrl, layerCounts, planAreas, planErrorAction, planStepsLite, recommendedFromPlan, stepsForTab } from "@/mobile/src/features/plan/viewModel";

const view = fixturePlanView();

describe("plan v2 görünüm modeli (KB §6.1; PLAN 4d) — PlanViewV2 sabit verisinden", () => {
  it("sekmeler plandaki alanlardan ve KB sırasıyla; adımlar sekmeye göre süzülür", () => {
    const areas = planAreas(view.plan);
    expect(areas[0]).toBe("hair");
    expect(areas).toContain("skin");
    expect(areas.indexOf("hair")).toBeLessThan(areas.indexOf("skin"));
    expect(stepsForTab(view.plan, "all")).toHaveLength(view.plan.steps.length);
    expect(stepsForTab(view.plan, "skin").every((s) => s.area === "skin")).toBe(true);
  });
  it("adım kartı alanları: ₺ aralığı, kaynak bağlantısı; katman sayıları; dışlamalar; saç dökülmesi", () => {
    expect(costLabel({ costTryRange: { min: 0, max: 0 } })).toEqual({ kind: "free" });
    expect(costLabel({ costTryRange: { min: 1500, max: null } })).toEqual({ kind: "from", min: "1.500" });
    expect(costLabel({ costTryRange: { min: 100, max: 250 } })).toEqual({ kind: "range", min: "100", max: "250" });
    expect(isHttpsUrl("https://pubmed.ncbi.nlm.nih.gov/x")).toBe(true);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    const counts = layerCounts(view);
    expect(counts.diy + counts.expert).toBe(view.plan.steps.length);
    expect(counts.doctor).toBe(0);
    expect(view.doctor.state).toBe("off");
    expect(exclusionEntries(view.plan).every((e) => typeof e.key === "string" && typeof e.value === "string")).toBe(true);
    expect(hairLossOf("possible")).toBe("possible");
    expect(hairLossOf("not_visible")).toBeNull();
    expect(hasScalpStepIn([{ id: "st_scalp_wash", title: "x" }])).toBe(true);
    expect(hasScalpStepIn([{ id: "x", title: "Saç derisi bakımı" }])).toBe(true);
    expect(hasScalpStepIn([{ id: "x", title: "SPF" }])).toBe(false);
  });
  it("glow-up adımları doktor katmanı hariç; önerilen presetler plan adımlarından; hata → eylem", () => {
    const lite = planStepsLite(view);
    expect(lite.length).toBe(view.plan.steps.length);
    expect(lite.every((s) => typeof s.title === "string" && s.area)).toBe(true);
    expect(recommendedFromPlan(view)).toContain("textured_crop");
    expect(planStepsLite(null)).toEqual([]);
    expect(planErrorAction("BAD_INPUT")).toBe("questionnaire");
    expect(planErrorAction("PREMIUM_REQUIRED")).toBe("premium");
    expect(planErrorAction("NETWORK")).toBe("retry");
  });
});

describe("anket v2 taslağı (Ç17; skoru değiştirmez)", () => {
  it("adımlar, devam koşulları, şemaya çevirme", () => {
    expect(STEPS_V2).toHaveLength(10);
    const d = initialDraftV2(undefined, { glassesDetected: null, headCoveringDetected: null });
    expect(canContinueV2("goals", d)).toBe(true);
    expect(canContinueV2("photo", d)).toBe(false); // tahmin yok, seçim yok
    const withChoice = { ...d, glasses: { detected: null, value: false }, headCovering: { detected: null, value: false } };
    expect(canContinueV2("photo", withChoice)).toBe(true);
    const prefilled = initialDraftV2(undefined, { glassesDetected: true, headCoveringDetected: false });
    expect(canContinueV2("photo", prefilled)).toBe(true);
    expect(canContinueV2("body", { ...d, bodySkipped: false, bodyDraft: { heightCm: "178", weightKg: "82,5" } })).toBe(true);
    expect(canContinueV2("body", { ...d, bodySkipped: false, bodyDraft: { heightCm: "50", weightKg: "82" } })).toBe(false);
    const payload = toPayloadV2({ ...withChoice, bodySkipped: false, bodyDraft: { heightCm: "178", weightKg: "82,5" } });
    expect(payload?.body).toEqual({ heightCm: 178, weightKg: 82.5 });
    expect(payload?.version).toBe("q.v2");
    expect(toPayloadV2({ ...d, goals: [] })).toBeNull();
    expect(progressPct(0)).toBe(10);
    expect(progressPct(9)).toBe(100);
  });
  it("mevcut cevaplar korunur, fotoğraf tahmini her açılışta tazelenir; taslak bellekte", () => {
    const initial = { ...emptyQuestionnaireV2(), goals: ["skin" as const], glasses: { detected: false, value: true }, headCovering: { detected: null, value: null }, body: { heightCm: 170, weightKg: 70 } };
    const d = initialDraftV2(initial, { glassesDetected: true, headCoveringDetected: false });
    expect(d.goals).toEqual(["skin"]);
    expect(d.glasses).toEqual({ detected: true, value: true });
    expect(d.headCovering).toEqual({ detected: false, value: null });
    expect(d.bodyDraft).toEqual({ heightCm: "170", weightKg: "70" });
    expect(d.bodySkipped).toBe(false);
    saveDraftV2("a1", d);
    expect(loadDraftV2("a1")?.goals).toEqual(["skin"]);
    expect(loadDraftV2("a2")).toBeNull();
    saveDraftV2("a1", null);
    expect(loadDraftV2("a1")).toBeNull();
  });
});
