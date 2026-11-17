import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/config/flags";
import { userDeliverable } from "@/lib/doctor/queue";
import { doctorLayerState, doctorStepCard } from "@/lib/doctor/rules";
import type { KnowledgeSource } from "./knowledge";
import { getKnowledgeSource } from "./knowledgeSource";
import { PlanV2, type PlanViewV2, type StepCard } from "./planTypes";
import { ClientSignalsV2, ReportV3 } from "@/lib/score/contract";
import { QuestionnaireV2Schema, type QuestionnaireV2 } from "@/lib/questionnaireV2";
import { isAgeBand, type AgeBand } from "@/lib/onboarding/age";

// Plan v2 saklama ve okuma (CONTRACTS_V2 S2.1 kural 3/6; migration 0013). Yalnız service role; analyses ve coach_reports
// tarayıcıya kapalıdır. Doktor katmanı plana yazılmaz: okuma anında kuyruktan (yalnız physician_reviewed/delivered) eklenir.

export type ReportRowV3 = { id: string; report: ReportV3 | null; planV2: PlanV2 | null; createdAt: string; planGeneratedAt: string | null };

export type ProfilePlanRow = {
  questionnaire: QuestionnaireV2 | null;
  questionnaireAt: string | null;
  ageBand: AgeBand | null;
  presentation: "male" | "female" | "unspecified";
  faceShapeOverride: string | null;
  bodyImageScreen: "ok" | "risk" | null;
};

export async function loadReportRowV3(admin: SupabaseClient, userId: string, analysisId: string): Promise<ReportRowV3 | null> {
  const { data } = await admin
    .from("coach_reports")
    .select("id, report, plan_v2, created_at")
    .eq("user_id", userId)
    .eq("analysis_id", analysisId)
    .eq("prompt_version", "report.v3")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const report = ReportV3.safeParse(data.report);
  const plan = data.plan_v2 == null ? null : PlanV2.safeParse(data.plan_v2);
  if (plan && !plan.success) console.warn(`[plan] plan_v2_parse_failed analysis=${analysisId}`);
  const planV2 = plan?.success ? plan.data : null;
  return { id: String(data.id), report: report.success ? report.data : null, planV2, createdAt: String(data.created_at), planGeneratedAt: planV2?.meta.generatedAt ?? null };
}

export async function loadProfilePlanRow(admin: SupabaseClient, userId: string): Promise<ProfilePlanRow> {
  const { data } = await admin.from("profiles").select("questionnaire_v2, questionnaire_v2_at, age_band, presentation, face_shape_override, body_image_screen_result").eq("id", userId).maybeSingle();
  const q = QuestionnaireV2Schema.safeParse(data?.questionnaire_v2);
  const p = data?.presentation;
  return {
    questionnaire: q.success ? q.data : null,
    questionnaireAt: data?.questionnaire_v2_at ? String(data.questionnaire_v2_at) : null,
    ageBand: isAgeBand(data?.age_band) ? data.age_band : null,
    presentation: p === "male" || p === "female" ? p : "unspecified",
    faceShapeOverride: data?.face_shape_override ? String(data.face_shape_override) : null,
    bodyImageScreen: data?.body_image_screen_result === "ok" || data?.body_image_screen_result === "risk" ? data.body_image_screen_result : null,
  };
}

export async function savePlan(admin: SupabaseClient, reportRowId: string, plan: PlanV2): Promise<void> {
  const { error } = await admin.from("coach_reports").update({ plan_v2: plan, plan_version: "plan.v2", report_version: "report.v3" }).eq("id", reportRowId);
  if (error) throw new Error(`coach_reports plan update failed: ${error.code ?? "?"}`);
}

/** Anket plandan sonra güncellendiyse (yeniden üretim ücretli, Ç10). */
export function isBasisStale(plan: PlanV2, questionnaireAt: string | null): boolean {
  if (!questionnaireAt) return false;
  const q = Date.parse(questionnaireAt);
  const p = Date.parse(plan.meta.generatedAt);
  return Number.isFinite(q) && Number.isFinite(p) && q > p;
}

export type PlanViewArgs = { admin: SupabaseClient; userId: string; analysisId: string; plan: PlanV2; profile: ProfilePlanRow; knowledge?: KnowledgeSource; env?: Record<string, string | undefined> };

/** Okuma anındaki görünüm: plan + doktor katmanı (yalnız hekim onaylı satır) + çiplerin güncelliği. */
export async function buildPlanView(a: PlanViewArgs): Promise<PlanViewV2> {
  const env = a.env ?? process.env;
  const flagEnabled = isFeatureEnabled("doctorLayer", env);
  let steps: StepCard[] = [];
  let rows: { status: "draft" | "physician_reviewed" | "delivered" | "rejected" }[] = [];
  if (flagEnabled && a.profile.ageBand !== "under_18" && a.profile.bodyImageScreen === "ok") {
    const d = await userDeliverable(a.admin, a.userId, a.analysisId);
    rows = d.rows;
    const knowledge = a.knowledge ?? getKnowledgeSource();
    steps = await Promise.all(d.items.map(async (it) => doctorStepCard(it, await knowledge.get(it.methodId))));
  }
  const state = doctorLayerState({ flagEnabled, under18: a.profile.ageBand === "under_18", screen: a.profile.bodyImageScreen, rows });
  return { plan: a.plan, doctor: { state, steps: state === "available" ? steps : [], disclosure: true }, basisStale: isBasisStale(a.plan, a.profile.questionnaireAt) };
}

/** Saklı plan görünümü; plan yoksa null (üretim generatePlan'da). */
export async function getPlanView(admin: SupabaseClient, userId: string, analysisId: string): Promise<PlanViewV2 | null> {
  const [row, profile] = await Promise.all([loadReportRowV3(admin, userId, analysisId), loadProfilePlanRow(admin, userId)]);
  if (!row?.planV2) return null;
  return buildPlanView({ admin, userId, analysisId, plan: row.planV2, profile });
}

/** Analizin plan girdisi: gözlemler (fotoğraf gerçekleri, saç dökülmesi), sinyaller (açı sayısı, önce odaklan, yüz şekli). */
export type AnalysisPlanRow = {
  id: string;
  status: string;
  faceShape: string | null;
  faceShapeDetailed: string | null;
  viewsUsed: number;
  improveFirst: { stepId: string; step: string }[];
  photoFacts: string[];
  hairLossSignal: "none" | "possible" | "visible" | "not_visible" | null;
};

export async function loadAnalysisPlanRow(admin: SupabaseClient, userId: string, analysisId: string): Promise<AnalysisPlanRow | null> {
  const { data } = await admin.from("analyses").select("id, status, engine_version, face_shape, observations, signals").eq("id", analysisId).eq("user_id", userId).maybeSingle();
  if (!data) return null;
  const signals = ClientSignalsV2.safeParse(data.signals);
  const obs = (data.observations ?? {}) as { other?: unknown; hairLossSignal?: unknown };
  const other = Array.isArray(obs.other) ? obs.other.filter((x): x is string => typeof x === "string").slice(0, 3) : [];
  const hl = obs.hairLossSignal;
  return {
    id: String(data.id),
    status: String(data.status),
    faceShape: data.face_shape ? String(data.face_shape) : null,
    faceShapeDetailed: signals.success ? (signals.data.faceShapeDetailed?.shape ?? null) : null,
    viewsUsed: signals.success ? signals.data.viewsUsed.length : 0,
    improveFirst: signals.success ? signals.data.improveFirst.map((i) => ({ stepId: i.stepId, step: i.step })) : [],
    photoFacts: other,
    hairLossSignal: hl === "none" || hl === "possible" || hl === "visible" || hl === "not_visible" ? hl : null,
  };
}
