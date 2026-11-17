import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { knowledgeQueryFrom, planContextFrom } from "@/lib/coach/generatePlan";
import type { KnowledgeSource } from "@/lib/coach/knowledge";
import { getKnowledgeSource } from "@/lib/coach/knowledgeSource";
import { isUnder18 } from "@/lib/coach/planBasisV2";
import { loadAnalysisPlanRow, loadProfilePlanRow, loadReportRowV3 } from "@/lib/coach/planStore";
import { isFeatureEnabled } from "@/lib/config/flags";
import { draftDoctorRecommendations, type DoctorDraftProvider } from "./generate";
import { hasActiveDoctorRow } from "./queue";

// Doktor katmanı taslağını KUYRUĞA koyar (KB Ç3/Ç5; PLAN 4f). Tetik: beden algısı taraması "ok" olduğunda (POST
// /api/doctor/screen) — plan üretimi sırasında tarama henüz yoktur, bu yüzden taslak yalnız orada denenirse kuyruk hep boş
// kalır. Kapılar: flag açık, 18+, tarama "ok", tamamlanmış analiz + rapor v3 + plan_v2 var, bu analiz için reddedilmemiş
// satır YOK (tek taslak). Çıktı kullanıcıya hiçbir yoldan gitmez; yalnız satır kimliği döner.

export type EnqueueDoctorDraftArgs = {
  admin: SupabaseClient;
  userId: string;
  analysisId: string;
  env?: Record<string, string | undefined>;
  knowledge?: KnowledgeSource;
  provider?: DoctorDraftProvider;
  timeoutMs?: number;
};

export async function enqueueDoctorDraft(a: EnqueueDoctorDraftArgs): Promise<{ id: string } | null> {
  const env = a.env ?? process.env;
  if (!isFeatureEnabled("doctorLayer", env)) return null;
  const [analysis, reportRow, profile] = await Promise.all([loadAnalysisPlanRow(a.admin, a.userId, a.analysisId), loadReportRowV3(a.admin, a.userId, a.analysisId), loadProfilePlanRow(a.admin, a.userId)]);
  if (!analysis || analysis.status !== "completed" || !reportRow?.report || !reportRow.planV2) return null;
  const ctx = planContextFrom(profile, analysis, env);
  if (!ctx || isUnder18(ctx.ageBand) || ctx.bodyImageScreen !== "ok") return null;
  if (await hasActiveDoctorRow(a.admin, a.userId, a.analysisId)) return null;
  const knowledge = a.knowledge ?? getKnowledgeSource();
  return draftDoctorRecommendations({
    admin: a.admin,
    userId: a.userId,
    analysisId: a.analysisId,
    reportId: reportRow.id,
    report: reportRow.report,
    under18: false,
    screen: "ok",
    knowledge,
    query: knowledgeQueryFrom(ctx, reportRow.report, analysis.photoFacts),
    env,
    provider: a.provider,
    signal: new AbortController().signal,
    timeoutMs: a.timeoutMs,
  });
}
