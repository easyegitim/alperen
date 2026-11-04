import { describe, expect, it } from "vitest";
import type { PlanSelectionProvider, PlanSelectionResult } from "@/lib/ai/provider";
import { ApiError } from "@/lib/api/errors";
import { generatePlanV2, knowledgeQueryFrom, planContextFrom } from "@/lib/coach/generatePlan";
import { MethodsKnowledgeSource, type MethodsFile } from "@/lib/coach/knowledge";
import { PlanV2 } from "@/lib/coach/planTypes";
import { ZERO_USAGE } from "@/lib/config/ai.server";
import { FIXTURE_REPORT, FIXTURE_SIGNALS } from "@/tests/fixtures/analysisV2";
import { FIXTURE_QUESTIONNAIRE_V2, fixturePlanContext } from "@/tests/fixtures/planV2";
import { FakePostgrest } from "@/tests/helpers/fakePostgrest";

// Sahte PostgREST (tests/helpers/fakePostgrest.ts): gerçek supabase-js istemcisi, bellek içi tablolar. Ağ, Claude, fotoğraf yok.

const USER = "22222222-2222-4222-8222-222222222222";
const ANALYSIS = "11111111-1111-4111-8111-111111111111";

function seed(over: { questionnaire?: unknown; questionnaireAt?: string | null; plan?: unknown; screen?: "ok" | "risk" | null; ageBand?: string } = {}) {
  const db = new FakePostgrest();
  db.tables.analyses = [{ id: ANALYSIS, user_id: USER, status: "completed", engine_version: "hybrid.v2", face_shape: "oval", observations: { other: ["Saç uçları dağınık"], hairLossSignal: "possible", glassesDetected: false, headCoveringDetected: false }, signals: FIXTURE_SIGNALS }];
  db.tables.coach_reports = [{ id: "rep-1", user_id: USER, analysis_id: ANALYSIS, prompt_version: "report.v3", report: FIXTURE_REPORT, plan_v2: over.plan ?? null, created_at: "2026-11-04T10:00:00.000Z" }];
  db.tables.profiles = [{ id: USER, questionnaire_v2: "questionnaire" in over ? over.questionnaire : FIXTURE_QUESTIONNAIRE_V2, questionnaire_v2_at: over.questionnaireAt ?? "2026-11-04T11:00:00.000Z", age_band: over.ageBand ?? "25_34", presentation: "male", face_shape_override: null, body_image_screen_result: over.screen ?? null, unlimited_quota: false }];
  db.tables.doctor_recommendations = [];
  return db;
}
const asAdmin = (db: FakePostgrest) => db.client;

function provider(out: PlanSelectionResult["out"], calls: string[] = []): PlanSelectionProvider {
  return {
    model: "claude-opus-5-5",
    async selectPlan(userMessage) {
      calls.push(userMessage);
      return { out, usage: ZERO_USAGE, model: "claude-opus-5-5", estUsd: 0, fallbackServed: false };
    },
  };
}
const SELECTION = { selections: [
  { id: "st_spf", phase: "weeks_0_4" as const, region: "skin" as const, rationale: "T bölgesindeki parlama için." },
  { id: "textured_crop", phase: "weeks_0_4" as const, region: "hair" as const, rationale: "Dağınık uçları toplar." },
  { id: "uydurma_yontem", phase: "weeks_0_4" as const, region: "skin" as const, rationale: "Bu düşmeli." },
] };
const env = { FEATURE_DOCTOR_LAYER: "false" };

describe("generatePlanV2 (PLAN 4d/4e/4f; CONTRACTS_V2 S2.1 kural 1/3/6; Ç10)", () => {
  it("rapor v3 + anket v2 → Claude seçimi → kod doğrular → coach_reports.plan_v2; bilinmeyen kimlik düşer; doktor katmanı off", async () => {
    const db = seed();
    const calls: string[] = [];
    const r = await generatePlanV2({ admin: asAdmin(db), userId: USER, analysisId: ANALYSIS, provider: provider(SELECTION, calls), env, now: () => Date.parse("2026-11-04T12:00:00.000Z") });
    expect(r.created).toBe(true);
    expect(r.fallback).toBe(false);
    const ids = r.view.plan.steps.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["st_spf", "textured_crop"]));
    // yalnız retrieve edilen kayıtlardan seçim geçerli; seçilen her kimlik retrievedIds içinde
    for (const id of ids) expect(r.view.plan.meta.retrievedIds).toContain(id);
    expect(ids).not.toContain("uydurma_yontem");
    expect(r.view.plan.meta.droppedUnknownIds).toBe(1);
    expect(r.view.plan.meta.promptVersion).toBe("plan.v2");
    expect(r.view.plan.meta.retrievedIds.length).toBeLessThanOrEqual(40);
    expect(r.view.doctor).toEqual({ state: "off", steps: [], disclosure: true });
    expect(r.view.basisStale).toBe(false);
    const row = db.tables.coach_reports![0]!;
    expect(row.plan_version).toBe("plan.v2");
    expect(row.report_version).toBe("report.v3");
    expect(PlanV2.safeParse(row.plan_v2).success).toBe(true);
    // Claude'a yalnız istem metni gider; skor/oran yok; kayıt listesi ≤ 40 kimlik
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toMatch(/overall|fwhr|weightKg/);
    expect(db.tables.doctor_recommendations).toHaveLength(0);
    expect(db.log.some((l) => l.startsWith("insert doctor"))).toBe(false);
    // az seçim tamamlandı (en az 6 adım)
    expect(r.view.plan.steps.length).toBeGreaterThanOrEqual(6);
  });

  it("saklı plan varsa yeniden üretmez; regenerate yalnız anket güncellendiyse (Ç10), aksi hâlde QUOTA_EXCEEDED", async () => {
    const db = seed();
    const calls: string[] = [];
    const first = await generatePlanV2({ admin: asAdmin(db), userId: USER, analysisId: ANALYSIS, provider: provider(SELECTION, calls), env, now: () => Date.parse("2026-11-04T12:00:00.000Z") });
    const again = await generatePlanV2({ admin: asAdmin(db), userId: USER, analysisId: ANALYSIS, provider: provider(SELECTION, calls), env });
    expect(again.created).toBe(false);
    expect(again.view.plan.meta.generatedAt).toBe(first.view.plan.meta.generatedAt);
    expect(calls).toHaveLength(1);
    await expect(generatePlanV2({ admin: asAdmin(db), userId: USER, analysisId: ANALYSIS, regenerate: true, provider: provider(SELECTION, calls), env })).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" } satisfies Partial<ApiError>);
    // anket plandan sonra güncellendi → basisStale → yeniden üretim serbest
    db.tables.profiles![0]!.questionnaire_v2_at = "2026-11-04T13:00:00.000Z";
    const stale = await generatePlanV2({ admin: asAdmin(db), userId: USER, analysisId: ANALYSIS, provider: provider(SELECTION, calls), env });
    expect(stale.view.basisStale).toBe(true);
    const regen = await generatePlanV2({ admin: asAdmin(db), userId: USER, analysisId: ANALYSIS, regenerate: true, provider: provider(SELECTION, calls), env, now: () => Date.parse("2026-11-04T14:00:00.000Z") });
    expect(regen.created).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("Claude başarısızsa (refusal/şema) belirlenimci yedek: plan boş gitmez, promptVersion '+fallback'", async () => {
    const db = seed();
    const r = await generatePlanV2({ admin: asAdmin(db), userId: USER, analysisId: ANALYSIS, provider: provider(null), env });
    expect(r.fallback).toBe(true);
    expect(r.view.plan.steps.length).toBeGreaterThanOrEqual(6);
    expect(r.view.plan.meta.promptVersion).toBe("plan.v2+fallback");
    expect(r.view.plan.steps.every((s) => s.tier !== "doctor")).toBe(true);
  });

  it("anket v2 yoksa BAD_INPUT questionnaire_required; tamamlanmamış analizde BAD_INPUT", async () => {
    const db = seed({ questionnaire: null });
    await expect(generatePlanV2({ admin: asAdmin(db), userId: USER, analysisId: ANALYSIS, provider: provider(SELECTION), env })).rejects.toMatchObject({ code: "BAD_INPUT", message: "questionnaire_required" });
    const running = seed();
    running.tables.analyses![0]!.status = "running";
    await expect(generatePlanV2({ admin: asAdmin(running), userId: USER, analysisId: ANALYSIS, provider: provider(SELECTION), env })).rejects.toMatchObject({ code: "BAD_INPUT" });
  });

  it("doktor katmanı: flag kapalıyken doctor kaydı bilgi tabanında olsa bile kuyruğa hiçbir şey yazılmaz ve plana girmez", async () => {
    const doctorFile: MethodsFile = {
      version: "methods.v1",
      importedAt: "2026-11-04T00:00:00.000Z",
      sourceFile: "test",
      records: [{ id: "dr_topical", area: "skin", title: "Hekim kararı", summary: "x", tier: "doctor", evidence: { level: "many_studies" }, costBand: "medium", frequency: { per: "day", times: 1 }, minutesPerDay: 1, difficulty: 1, impact: 2, effort: 1, tags: ["parlama"], regions: ["skin"], contraindications: [], flawIds: [], source: { kind: "tsv", ref: "t#1" } }],
    };
    const knowledge = new MethodsKnowledgeSource([doctorFile]);
    const db = seed({ screen: "ok" });
    const sel = { selections: [...SELECTION.selections, { id: "dr_topical", phase: "weeks_0_4" as const, region: "skin" as const, rationale: "Hekim." }] };
    const r = await generatePlanV2({ admin: asAdmin(db), userId: USER, analysisId: ANALYSIS, provider: provider(sel), knowledge, env });
    expect(r.view.plan.steps.some((s) => s.id === "dr_topical")).toBe(false);
    expect(r.view.plan.layers.doctor).toEqual([]);
    expect(r.view.plan.meta.knowledgeSource).toBe("methods");
    expect(db.tables.doctor_recommendations).toHaveLength(0);
    expect(r.view.doctor.state).toBe("off");
    // flag açık + 18 altı → under_18; kuyruğa yine yazılmaz (ANTHROPIC_API_KEY yok → sağlayıcı yapılandırma hatası yutulur)
    const minor = seed({ screen: "ok", ageBand: "under_18" });
    const r2 = await generatePlanV2({ admin: asAdmin(minor), userId: USER, analysisId: ANALYSIS, provider: provider(sel), knowledge, env: { FEATURE_DOCTOR_LAYER: "true" } });
    expect(minor.tables.doctor_recommendations).toHaveLength(0);
    expect(r2.view.doctor.state).toBe("under_18");
    expect(r2.view.plan.disclaimers).toContain("under18Limits");
  });

  it("bağlam ve sorgu: yüz şekli önceliği (override > detaylı > ön), fotoğraf gerçekleri, izinli alanlar", () => {
    const profile = { questionnaire: FIXTURE_QUESTIONNAIRE_V2, questionnaireAt: null, ageBand: "25_34" as const, presentation: "male" as const, faceShapeOverride: "round", bodyImageScreen: null };
    const ctx = planContextFrom(profile, { faceShape: "oval", faceShapeDetailed: "square", viewsUsed: 3, photoFacts: ["x"] }, env)!;
    expect(ctx.faceShape).toBe("round");
    expect(ctx.faceShapeSource).toBe("override");
    expect(planContextFrom({ ...profile, faceShapeOverride: null }, { faceShape: "oval", faceShapeDetailed: "square", viewsUsed: 1, photoFacts: [] }, env)!.faceShapeSource).toBe("detailed");
    expect(planContextFrom({ ...profile, questionnaire: null }, { faceShape: null, faceShapeDetailed: null, viewsUsed: 0, photoFacts: [] }, env)).toBeNull();
    const q = knowledgeQueryFrom(fixturePlanContext(), FIXTURE_REPORT, ["Saç uçları dağınık"]);
    expect(q.observations[0]).toBe("Saç uçları dağınık");
    expect(q.regions).toEqual(["brows", "skin", "hair"]);
    expect(q.areas).toContain("exercise");
    expect(q.constraints.doctorLayer).toBe(false);
  });
});
