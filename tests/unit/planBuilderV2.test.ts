import { describe, expect, it } from "vitest";
import { ALL_PRESETS } from "@/content/presets";
import { CatalogKnowledgeSource, type MethodRecord } from "@/lib/coach/knowledge";
import { PLAN_MAX_STEPS, buildPlanV2, defaultPhase, fallbackSelections, observationFor, resolveRegion, safeText, topUpSelections, type PlanSelection } from "@/lib/coach/plan";
import { PERCEPTION_AREAS, STRUCTURAL_REGIONS, planIssues } from "@/lib/coach/planTypes";
import { barberSpecFor } from "@/lib/coach/barber";
import { WEIGHT_CONTENT_RE } from "@/lib/coach/bodyRules";
import { FIXTURE_REPORT } from "@/tests/fixtures/analysisV2";
import { FIXTURE_SELECTIONS, fixturePlanContext, fixturePlanView } from "@/tests/fixtures/planV2";

const src = new CatalogKnowledgeSource();
const records = src.allRecords();
const meta = { analysisId: "11111111-1111-4111-8111-111111111111", generatedAt: "2026-11-04T12:00:00.000Z", model: "test", promptVersion: "plan.v2", knowledgeSource: "catalog" as const, retrievedIds: [], droppedUnknownIds: 0 };
const build = (selections: PlanSelection[], ctx = fixturePlanContext(), recs: readonly MethodRecord[] = records) => buildPlanV2({ selections, records: recs, report: FIXTURE_REPORT, ctx, meta });

describe("buildPlanV2 (PLAN 4d/4e; KB §6.1, K6–K10, Ç1, Ç2; CONTRACTS_V2 S2.1)", () => {
  it("her adım kimliği content/ kataloğunda çözülür; bilinmeyen kimlik düşer ve sayılır", () => {
    const { plan, dropped } = build([...FIXTURE_SELECTIONS, { id: "uydurma_yontem" }, { id: "st_spf" }]);
    const known = new Set(records.map((r) => r.id));
    for (const s of plan.steps) expect(known.has(s.id), s.id).toBe(true);
    expect(dropped).toContainEqual({ id: "uydurma_yontem", reason: "unknown" });
    expect(dropped).toContainEqual({ id: "st_spf", reason: "duplicate" });
    expect(plan.meta.droppedUnknownIds).toBe(1);
    expect(planIssues(plan)).toEqual([]);
  });

  it("yapısal bölgeye (göz, burun, elmacık, çene) yalnız algı/stil adımı bağlanır ve perceptionOnly işaretlenir", () => {
    const { plan } = build([
      { id: "stubble_heavy", region: "jawline" },
      { id: "st_spf", region: "jawline" },
      { id: "ex_chin_tuck", region: "jawline" },
      { id: "hb_sleep", region: "cheeks" },
    ]);
    const beard = plan.steps.find((s) => s.id === "stubble_heavy")!;
    expect(beard.observationRef.region).toBe("jawline");
    expect(beard.perceptionOnly).toBe(true);
    for (const id of ["st_spf", "ex_chin_tuck", "hb_sleep"]) {
      const s = plan.steps.find((x) => x.id === id)!;
      expect((STRUCTURAL_REGIONS as readonly string[]).includes(s.observationRef.region), id).toBe(false);
      expect(s.perceptionOnly).toBeUndefined();
    }
    expect(plan.steps.every((s) => !(STRUCTURAL_REGIONS as readonly string[]).includes(s.observationRef.region) || ((PERCEPTION_AREAS as readonly string[]).includes(s.area) && s.perceptionOnly))).toBe(true);
  });

  it("K10: çene sağlığı cevabı varsa egzersiz adımı plana giremez; exclusion görünür", () => {
    const ctx = fixturePlanContext({ questionnaire: { ...fixturePlanContext().questionnaire, jawHealth: ["bruxism"] } });
    const { plan, dropped } = build([{ id: "ex_chin_tuck" }, { id: "ex_masseter_gum" }, { id: "st_spf" }], ctx);
    expect(plan.steps.some((s) => s.area === "exercise")).toBe(false);
    expect(dropped.filter((d) => d.reason === "area" || d.reason === "constraint").map((d) => d.id)).toEqual(expect.arrayContaining(["ex_chin_tuck", "ex_masseter_gum"]));
    expect(plan.exclusions.exercises).toBe("jaw_health");
    expect(plan.basisChips.some((c) => c.key === "jawHealth")).toBe(true);
  });

  it("K9/Ç17: başörtüsü varsa ya da bilinmiyorsa saç, renk ve saç alışkanlığı adımı yok", () => {
    const q = fixturePlanContext().questionnaire;
    const covered = fixturePlanContext({ questionnaire: { ...q, headCovering: { detected: true, value: null } } });
    const sel: PlanSelection[] = [{ id: "textured_crop" }, { id: "darker_natural" }, { id: "st_matte_clay" }, { id: "hb_hair_wash_rhythm" }, { id: "st_spf" }];
    const a = build(sel, covered);
    expect(a.plan.steps.map((s) => s.id)).toEqual(["st_spf"]);
    expect(a.plan.exclusions.hair).toBe("head_covering");
    const unknown = fixturePlanContext({ questionnaire: { ...q, headCovering: { detected: null, value: null } } });
    const b = build(sel, unknown);
    expect(b.plan.steps.some((s) => s.area === "hair" || s.area === "color")).toBe(false);
    expect(b.plan.exclusions.hair).toBe("head_covering_unknown");
  });

  it("K8/Ç1: kilo alışkanlıkları yalnız VKİ ≥ 25 ve 18+; aksi hâlde exclusion.bodyFat nedeniyle", () => {
    const q = fixturePlanContext().questionnaire;
    const lean = fixturePlanContext({ questionnaire: { ...q, body: { heightCm: 180, weightKg: 70 } } });
    expect(build([{ id: "hb_protein" }, { id: "hb_strength" }], lean).plan.steps.map((s) => s.id)).toEqual(["hb_strength"]);
    expect(build([], lean).plan.exclusions.bodyFat).toBe("bmi_below_25");
    const noBody = fixturePlanContext({ questionnaire: { ...q, body: undefined } });
    expect(build([{ id: "hb_protein" }], noBody).plan.steps).toHaveLength(0);
    expect(build([], noBody).plan.exclusions.bodyFat).toBe("no_body");
    const minor = fixturePlanContext({ ageBand: "under_18" });
    expect(build([{ id: "hb_protein" }], minor).plan.steps).toHaveLength(0);
    expect(build([], minor).plan.exclusions.bodyFat).toBe("under_18");
    expect(build([], minor).plan.disclaimers).toContain("under18Limits");
    // VKİ ≥ 25 (fikstür 178/82): izinli; hb_walk (30 dk) ise günlük süre bandı (10 dk) nedeniyle düşer
    expect(build([{ id: "hb_protein" }]).plan.steps.map((s) => s.id)).toEqual(["hb_protein"]);
    expect(build([{ id: "hb_walk" }]).dropped).toContainEqual({ id: "hb_walk", reason: "constraint" });
    // Çiplerde boy/kilo/VKİ asla yok
    for (const c of build([]).plan.basisChips) expect(JSON.stringify(c)).not.toMatch(/178|82|25\.9|bmi|vki/i);
  });

  it("doktor katmanı adımı plana yazılmaz; sakal kadın sunumunda ve 'yok' tercihinde yok", () => {
    const doctor: MethodRecord = { ...records.find((r) => r.id === "st_spf")!, id: "dr_sample", tier: "doctor" };
    const { plan, dropped } = build([{ id: "dr_sample" }], fixturePlanContext(), [...records, doctor]);
    expect(plan.steps).toHaveLength(0);
    expect(plan.layers.doctor).toEqual([]);
    expect(dropped).toContainEqual({ id: "dr_sample", reason: "doctor_tier" });
    const female = fixturePlanContext({ presentation: "female" });
    expect(build([{ id: "stubble_heavy" }, { id: "st_beard_oil" }], female).plan.steps).toHaveLength(0);
    expect(build([], female).plan.exclusions.beard).toBe("presentation");
    const none = fixturePlanContext({ questionnaire: { ...fixturePlanContext().questionnaire, beardLengthPref: "none" } });
    expect(build([{ id: "stubble_heavy" }], none).plan.steps).toHaveLength(0);
    expect(build([], none).plan.exclusions.beard).toBe("preference");
  });

  it("bütçe bandı: aylık maliyeti aşan tekrarlı adım düşer; tek seferlik kesim kalır", () => {
    const pricey: MethodRecord = { ...records.find((r) => r.id === "st_spf")!, id: "st_pricey", costBand: "high", costTryRange: { min: 3000, max: null } };
    const q = fixturePlanContext().questionnaire;
    const low = fixturePlanContext({ questionnaire: { ...q, budget: "upto_1000" } });
    const { plan, dropped } = build([{ id: "st_pricey" }, { id: "textured_crop" }], low, [...records, pricey]);
    expect(dropped).toContainEqual({ id: "st_pricey", reason: "budget" });
    expect(plan.steps.map((s) => s.id)).toEqual(["textured_crop"]);
    const high = fixturePlanContext({ questionnaire: { ...q, budget: "5000_plus" } });
    expect(build([{ id: "st_pricey" }], high, [...records, pricey]).plan.steps).toHaveLength(1);
  });

  it("safety.ts: ihlalli gerekçe düşer; kayıt özeti (ne yapılacağı) HER ZAMAN kalır, gerekçe ayrı alandır; gözlem metni rapordan nötr gelir", () => {
    const { plan } = build([
      { id: "st_spf", rationale: "Bu adım skoru 0,4 puan artırır." },
      { id: "st_cleanser_foaming", rationale: "Botoks yerine bunu dene." },
      { id: "st_moisturizer_light", rationale: "Parlamayı dengeler." },
    ]);
    const [a, b, c] = plan.steps;
    expect(a!.rationale).toBeUndefined();
    expect(a!.summary).toBe(records.find((r) => r.id === "st_spf")!.summary);
    expect(b!.rationale).toBeUndefined();
    expect(JSON.stringify(b)).not.toMatch(/botoks/i);
    expect(c!.rationale).toBe("Parlamayı dengeler.");
    expect(c!.summary).toBe(records.find((r) => r.id === "st_moisturizer_light")!.summary);
    expect(a!.observationRef.observation).toBe("Günlük SPF");
    for (const s of plan.steps) {
      expect(s.summary ?? "").not.toMatch(WEIGHT_CONTENT_RE);
      expect(JSON.stringify(s)).not.toMatch(/score|puan|gain/i);
    }
  });

  it("faz, öncelik tablosu, katmanlar, çipler, uyarılar ve 'Dene'/'Berbere göster' alanları dolu; en çok 16 adım", () => {
    const view = fixturePlanView();
    const p = view.plan;
    expect(p.steps.length).toBe(FIXTURE_SELECTIONS.length);
    expect(p.priorityTable[0]!.score).toBeGreaterThanOrEqual(p.priorityTable.at(-1)!.score);
    expect([...p.phases.weeks_0_4, ...p.phases.months_1_3, ...p.phases.months_3_6].sort()).toEqual(p.steps.map((s) => s.id).sort());
    expect(p.layers.diy.length + p.layers.expert.length).toBe(p.steps.length);
    const hair = p.steps.find((s) => s.id === "textured_crop")!;
    expect(hair.tryonPresetId).toBe("textured_crop");
    expect(hair.barberSpec?.sidesGuard).toBeDefined();
    expect(hair.barberSpec?.topLengthCm).toBeGreaterThan(0);
    expect(hair.tier).toBe("expert");
    const beard = p.steps.find((s) => s.id === "stubble_heavy")!;
    expect(beard.barberSpec?.beardLine).toMatch(/hat/);
    expect(p.disclaimers).toEqual(expect.arrayContaining(["notMedicalAdvice", "aiGenerated", "cosmeticProcedures", "changeTakesWeeks"]));
    expect(p.basisChips.map((c) => c.key)).toEqual(expect.arrayContaining(["goal", "goalDirection", "budget", "minutes", "sportDays", "work", "hairLength", "beardLength", "skinType", "glasses", "headCovering", "faceShape", "ageBand", "presentation", "photoFact", "viewsUsed"]));
    const many = build(records.filter((r) => r.minutesPerDay <= 5 && (r.area === "skin" || r.area === "habit" || r.area === "brows" || r.area === "hair")).slice(0, 30).map((r) => ({ id: r.id })));
    expect(many.plan.steps.length).toBeLessThanOrEqual(PLAN_MAX_STEPS);
    expect(many.dropped.some((d) => d.reason === "limit")).toBe(true);
  });

  it("belirlenimci yedek: Claude yoksa alan başına sırayla seçim; az seçim tamamlanır; plan boş gitmez", () => {
    const sel = fallbackSelections(records, 10);
    expect(sel).toHaveLength(10);
    expect(new Set(sel.map((s) => s.id)).size).toBe(10);
    const areas = new Set(sel.map((s) => records.find((r) => r.id === s.id)!.area));
    expect(areas.size).toBeGreaterThan(3);
    const topped = topUpSelections([{ id: "st_spf" }], records, 6);
    expect(topped).toHaveLength(6);
    expect(topped[0]!.id).toBe("st_spf");
    expect(build(topped).plan.steps.length).toBeGreaterThan(0);
  });

  it("yardımcılar: varsayılan faz, bölge çözümü, metin kırpma, gözlem", () => {
    const spf = records.find((r) => r.id === "st_spf")!;
    expect(defaultPhase({ ...spf, effort: 3 })).toBe("months_3_6");
    expect(defaultPhase({ ...spf, effort: 2 })).toBe("months_1_3");
    expect(defaultPhase({ ...spf, tier: "expert", effort: 3 })).toBe("weeks_0_4");
    expect(resolveRegion({ area: "skin", regions: ["skin"] }, "nose")).toEqual({ region: "skin", perceptionOnly: false });
    expect(resolveRegion({ area: "hair", regions: ["hair"] }, "nose")).toEqual({ region: "nose", perceptionOnly: true });
    expect(resolveRegion({ area: "exercise", regions: [] }, undefined)).toEqual({ region: "skin", perceptionOnly: false });
    expect(safeText("x".repeat(500), 100)?.length).toBe(100);
    expect(safeText("Yüzündeki kusurlar", 100)).toBeUndefined();
    expect(observationFor(FIXTURE_REPORT, "eyeArea")).toBe("Göz altında hafif ton farkı.");
    expect(observationFor(FIXTURE_REPORT, "nose")).toBeUndefined();
  });

  it("berber kartı her saç ve sakal preset'i için stil adı taşır; renkte yalnız ad", () => {
    for (const p of ALL_PRESETS) {
      const spec = barberSpecFor(p.id)!;
      expect(spec.styleName).toBe(p.nameTr);
      if (p.kind === "hair") expect(spec.sidesGuard).toBeDefined();
      if (p.kind === "beard") expect(spec.beardLine).toBeDefined();
    }
    expect(barberSpecFor("st_spf")).toBeUndefined();
  });
});

describe("buildPlanV2 — inceleme düzeltmeleri (PLAN §3 kişiselleştirme; KB §6.1)", () => {
  it("tek seferlik bütçe: 'şimdilik yok' cevabında aylık bandı aşan tek seferlik uzman adımı düşer; 'bilmiyorum'da süzgeç yok; bant varsa bant", () => {
    const clinic: MethodRecord = { ...records.find((r) => r.id === "st_spf")!, id: "ex_expert_once", tier: "expert", costBand: "high", costTryRange: { min: 40_000, max: 80_000 }, frequency: { per: "once", times: 1 } };
    const q = fixturePlanContext().questionnaire;
    const none = fixturePlanContext({ questionnaire: { ...q, budget: "upto_1000", oneTimeBudget: "none" } });
    expect(build([{ id: "ex_expert_once" }], none, [...records, clinic]).dropped).toContainEqual({ id: "ex_expert_once", reason: "budget" });
    const unknown = fixturePlanContext({ questionnaire: { ...q, budget: "upto_1000", oneTimeBudget: "unknown" } });
    expect(build([{ id: "ex_expert_once" }], unknown, [...records, clinic]).plan.steps).toHaveLength(1);
    const low = fixturePlanContext({ questionnaire: { ...q, oneTimeBudget: "upto_15000" } });
    expect(build([{ id: "ex_expert_once" }], low, [...records, clinic]).dropped).toContainEqual({ id: "ex_expert_once", reason: "budget" });
    const high = fixturePlanContext({ questionnaire: { ...q, oneTimeBudget: "15000_60000" } });
    expect(build([{ id: "ex_expert_once" }], high, [...records, clinic]).plan.steps).toHaveLength(1);
    // aylık banda sığan tek seferlik kesim "şimdilik yok" cevabında da kalır
    expect(build([{ id: "textured_crop" }], none).plan.steps.map((s) => s.id)).toEqual(["textured_crop"]);
  });

  it("yüz şekli: kaydın uymadığı şekilde saç/sakal adımı düşer (kullanıcı düzeltmesi dahil); şekil bilinmiyorsa süzgeç yok", () => {
    const round = fixturePlanContext({ faceShape: "round", faceShapeSource: "override" });
    const r = build([{ id: "french_crop" }, { id: "textured_crop" }], round); // french_crop: oval/long/heart
    expect(r.dropped).toContainEqual({ id: "french_crop", reason: "face_shape" });
    expect(r.plan.steps.map((s) => s.id)).toEqual(["textured_crop"]);
    const unknown = fixturePlanContext({ faceShape: null, faceShapeSource: null });
    expect(build([{ id: "french_crop" }], unknown).plan.steps.map((s) => s.id)).toEqual(["french_crop"]);
  });

  it("sunum: kadın sunumunda yalnız erkek için tanımlı saç stili düşer (constraint); erkek sunumunda yalnız kadın stili düşer", () => {
    const female = fixturePlanContext({ presentation: "female", faceShape: "round", faceShapeSource: "detailed" });
    const r = build([{ id: "buzz_cut" }, { id: "pixie" }, { id: "st_spf" }], female);
    expect(r.dropped).toContainEqual({ id: "buzz_cut", reason: "constraint" });
    expect(r.plan.steps.map((s) => s.id)).toEqual(expect.arrayContaining(["st_spf"]));
    expect(r.plan.steps.some((s) => s.id === "buzz_cut")).toBe(false);
    const male = fixturePlanContext({ faceShape: null, faceShapeSource: null });
    expect(build([{ id: "pixie" }], male).dropped).toContainEqual({ id: "pixie", reason: "constraint" });
  });

  it("bilgi tabanı başlığı safety.ts'ten geçmezse kayıt düşer (eski JSON sızdırmaz); katalog başlıklarının hepsi geçer", () => {
    const bad: MethodRecord = { ...records.find((r) => r.id === "st_spf")!, id: "m_bad_title", title: "Retinoid krem" };
    const r = build([{ id: "m_bad_title" }, { id: "st_spf" }], fixturePlanContext(), [...records, bad]);
    expect(r.dropped).toContainEqual({ id: "m_bad_title", reason: "safety" });
    expect(r.plan.steps.map((s) => s.id)).toEqual(["st_spf"]);
    for (const rec of records) expect(safeText(rec.title, 120, { allowDigits: true }), rec.id).toBeDefined();
  });

  it("belirlenimci yedekte 'yapay zekâ ile hazırlandı' yazılmaz; kural tabanlı uyarısı yazılır", () => {
    const ai = build([{ id: "st_spf" }]).plan.disclaimers;
    expect(ai).toContain("aiGenerated");
    expect(ai).not.toContain("deterministicFallback");
    const fb = buildPlanV2({ selections: [{ id: "st_spf" }], records, report: FIXTURE_REPORT, ctx: fixturePlanContext(), meta: { ...meta, fallback: true } }).plan.disclaimers;
    expect(fb).toContain("deterministicFallback");
    expect(fb).not.toContain("aiGenerated");
    expect(fb).toContain("notMedicalAdvice");
  });
});
