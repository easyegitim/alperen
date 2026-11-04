import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { FACE_SHAPES } from "@/content/face-shapes";
import { DEADLINE_ABORT_REASON } from "@/lib/ai/anthropic";
import { buildPlanUserMessageV3 } from "@/lib/ai/prompts/report.v3";
import { PLAN_SELECTION_PROMPT_VERSION } from "@/lib/ai/reportSchema.v3";
import { COACH, getPlanSelectionProvider, type PlanSelectionProvider } from "@/lib/ai/provider";
import { ApiError } from "@/lib/api/errors";
import { isUnlimitedQuota } from "@/lib/api/quota";
import { isFeatureEnabled } from "@/lib/config/flags";
import { draftDoctorRecommendations } from "@/lib/doctor/generate";
import type { FaceShape } from "@/lib/face/types";
import { resolvePhotoConfirm } from "@/lib/questionnaireV2";
import { validateMethodIds, type KnowledgeQuery, type KnowledgeSource } from "./knowledge";
import { getKnowledgeSource } from "./knowledgeSource";
import { buildPlanV2, topUpSelections, type PlanSelection } from "./plan";
import { areasForContext, constraintsFromContext, isUnder18, type PlanContextV2 } from "./planBasisV2";
import { buildPlanView, isBasisStale, loadAnalysisPlanRow, loadProfilePlanRow, loadReportRowV3, savePlan, type ProfilePlanRow } from "./planStore";
import type { PlanViewV2 } from "./planTypes";
import { REGION_KEYS, type RegionKey } from "@/lib/score/contract";

// Plan v2 üretimi (PLAN 4d/4e/4f; KB §6; CONTRACTS_V2 S2.1–S2.4). Akış: rapor v3 + anket v2 + profil → bağlam → bilgi
// tabanından ≤ 40 kayıt (kısıtlar kodda) → Claude yalnız kimlik/faz/bölge/gerekçe seçer → kod doğrular, kurar, safety →
// coach_reports.plan_v2. Doktor taslağı yalnız flag + 18+ + tarama "ok" ile kuyruğa. Fotoğraf hiç yok; skor değişmez.

const FACE_SHAPE_KEYS: readonly string[] = ["oval", "round", "square", "long", "heart", "diamond"];
const asFaceShape = (v: string | null | undefined): FaceShape | null => (v && FACE_SHAPE_KEYS.includes(v) ? (v as FaceShape) : null);

export function planContextFrom(profile: ProfilePlanRow, analysis: { faceShape: string | null; faceShapeDetailed: string | null; viewsUsed: number; photoFacts: string[] }, env: Record<string, string | undefined> = process.env): PlanContextV2 | null {
  if (!profile.questionnaire) return null;
  const override = asFaceShape(profile.faceShapeOverride);
  const detailed = asFaceShape(analysis.faceShapeDetailed);
  const prelim = asFaceShape(analysis.faceShape);
  const faceShape = override ?? detailed ?? prelim;
  return {
    questionnaire: profile.questionnaire,
    presentation: profile.presentation,
    ageBand: profile.ageBand,
    faceShape,
    faceShapeSource: faceShape ? (override ? "override" : detailed ? "detailed" : "prelim") : null,
    viewsUsed: analysis.viewsUsed,
    photoFacts: analysis.photoFacts,
    bodyImageScreen: profile.bodyImageScreen,
    doctorLayerEnabled: isFeatureEnabled("doctorLayer", env),
  };
}

export function knowledgeQueryFrom(ctx: PlanContextV2, report: { regions: { key: RegionKey; seen: string; improvements: string[] }[] } | null, photoFacts: string[]): KnowledgeQuery {
  const observations = [...photoFacts, ...(report?.regions.flatMap((r) => [r.seen, ...r.improvements]) ?? [])];
  const regions = (report?.regions.filter((r) => r.improvements.length > 0).map((r) => r.key) ?? []).filter((k) => (REGION_KEYS as readonly string[]).includes(k));
  return { observations, areas: areasForContext(ctx), regions, goals: ctx.questionnaire.goals, goalDirection: ctx.questionnaire.goalDirection, constraints: constraintsFromContext(ctx) };
}

export type GeneratePlanArgs = {
  admin: SupabaseClient;
  userId: string;
  analysisId: string;
  regenerate?: boolean;
  provider?: PlanSelectionProvider;
  knowledge?: KnowledgeSource;
  env?: Record<string, string | undefined>;
  now?: () => number;
  deadlineMs?: number;
};

export type GeneratePlanResult = { view: PlanViewV2; created: boolean; fallback: boolean };

/**
 * Planı döndürür; yoksa üretir. regenerate: yalnız anket güncellendiyse (basisStale) ya da sınırsız kota — Ç10 ücretli
 * yeniden üretim ürünü AÇIK olduğundan başka durumda QUOTA_EXCEEDED. Claude başarısızsa belirlenimci seçim (plan boş gitmez).
 */
export async function generatePlanV2(a: GeneratePlanArgs): Promise<GeneratePlanResult> {
  const env = a.env ?? process.env;
  const now = a.now ?? Date.now;
  const [analysis, reportRow, profile] = await Promise.all([loadAnalysisPlanRow(a.admin, a.userId, a.analysisId), loadReportRowV3(a.admin, a.userId, a.analysisId), loadProfilePlanRow(a.admin, a.userId)]);
  if (!analysis || analysis.status !== "completed") throw new ApiError("BAD_INPUT", "Tamamlanmış analiz bulunamadı.");
  if (!reportRow || !reportRow.report) throw new ApiError("BAD_INPUT", "Rapor henüz hazır değil.");
  if (!profile.questionnaire) throw new ApiError("BAD_INPUT", "questionnaire_required");

  if (reportRow.planV2 && !a.regenerate) {
    return { view: await buildPlanView({ admin: a.admin, userId: a.userId, analysisId: a.analysisId, plan: reportRow.planV2, profile, knowledge: a.knowledge, env }), created: false, fallback: false };
  }
  if (reportRow.planV2 && a.regenerate) {
    const allowed = isBasisStale(reportRow.planV2, profile.questionnaireAt) || (await isUnlimitedQuota(a.admin, a.userId));
    if (!allowed) throw new ApiError("QUOTA_EXCEEDED", "Yeniden üretim ücretlidir ya da haktan düşer.");
  }

  const ctx = planContextFrom(profile, analysis, env);
  if (!ctx) throw new ApiError("BAD_INPUT", "questionnaire_required");
  const knowledge = a.knowledge ?? getKnowledgeSource();
  const query = knowledgeQueryFrom(ctx, reportRow.report, analysis.photoFacts);
  const records = await knowledge.retrieve(query, 40);
  const known = new Set(records.map((r) => r.id));

  // Claude seçimi (süre sınırlı); başarısızlıkta belirlenimci yedek.
  const provider = a.provider ?? getPlanSelectionProvider();
  const controller = new AbortController();
  const deadline = a.deadlineMs ?? COACH.deadlineMs;
  const timer = setTimeout(() => controller.abort(DEADLINE_ABORT_REASON), deadline);
  let selections: PlanSelection[] = [];
  let model = provider.model;
  let fallback = false;
  let droppedUnknown = 0;
  try {
    const q = ctx.questionnaire;
    const shape = ctx.faceShape ? FACE_SHAPES[ctx.faceShape] : null;
    const user = buildPlanUserMessageV3({
      report: reportRow.report,
      photoFacts: analysis.photoFacts,
      improveFirst: analysis.improveFirst,
      faceShape: ctx.faceShape && shape ? { primary: ctx.faceShape, nameTr: shape.nameTr, descriptionTr: shape.descriptionTr } : null,
      questionnaire: {
        goals: q.goals,
        goalDirection: q.goalDirection,
        budget: q.budget,
        minutesPerDay: q.minutesPerDay,
        sportDays: q.activity.sportDays,
        work: q.activity.work,
        hairLengthPref: q.hairLengthPref,
        beardLengthPref: q.beardLengthPref,
        skinType: q.skinType,
        glasses: resolvePhotoConfirm(q.glasses),
        headCovering: resolvePhotoConfirm(q.headCovering),
      },
      allowedAreas: areasForContext(ctx),
      records,
    });
    const res = await provider.selectPlan(user, controller.signal, Math.min(COACH.attemptTimeoutMs, deadline));
    model = res.model;
    if (res.out) {
      const v = validateMethodIds(res.out.selections.map((s) => s.id), known);
      droppedUnknown = v.dropped.length;
      const valid = new Set(v.valid);
      selections = res.out.selections.filter((s) => valid.has(s.id)).map((s) => ({ id: s.id, phase: s.phase, region: s.region, rationale: s.rationale }));
    } else {
      fallback = true;
    }
  } finally {
    clearTimeout(timer);
  }
  if (selections.length === 0) fallback = true;
  selections = topUpSelections(selections, records);

  const { plan } = buildPlanV2({
    selections,
    records,
    report: reportRow.report,
    ctx,
    meta: {
      analysisId: a.analysisId,
      generatedAt: new Date(now()).toISOString(),
      model,
      promptVersion: fallback ? `${PLAN_SELECTION_PROMPT_VERSION}+fallback` : PLAN_SELECTION_PROMPT_VERSION,
      knowledgeSource: knowledge.name,
      retrievedIds: records.map((r) => r.id),
      droppedUnknownIds: droppedUnknown,
    },
  });
  await savePlan(a.admin, reportRow.id, plan);

  // Doktor katmanı taslağı: yalnız flag + 18+ + tarama "ok"; kuyruğa yazar, kullanıcıya dönmez. Hata planı bozmaz.
  try {
    await draftDoctorRecommendations({
      admin: a.admin,
      userId: a.userId,
      analysisId: a.analysisId,
      reportId: reportRow.id,
      report: reportRow.report,
      under18: isUnder18(ctx.ageBand),
      screen: ctx.bodyImageScreen,
      knowledge,
      query,
      env,
      signal: new AbortController().signal,
    });
  } catch (e) {
    console.warn(`[doctor] draft skipped: ${e instanceof Error ? e.name : "error"}`);
  }

  return { view: await buildPlanView({ admin: a.admin, userId: a.userId, analysisId: a.analysisId, plan, profile, knowledge, env }), created: true, fallback };
}
