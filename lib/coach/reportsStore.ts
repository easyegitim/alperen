import "server-only";

import { LEVERS } from "@/content/levers";
import { ApiError } from "@/lib/api/errors";
import { assertEngineReady } from "@/lib/config/ai.server";
import { ENGINE_STATUS } from "@/lib/config/engine.server";
import { ENTITLEMENTS } from "@/lib/config/plans";
import { createAdminClient } from "@/lib/db/admin";
import type { GeometryResult } from "@/lib/face/types";
import { QuestionnaireSchema } from "@/lib/questionnaire";
import { ClientSignals, type ImproveItem, type NotAssessed } from "@/lib/score/contract";
import tr from "@/messages/tr.json";
import { generateCoachReport, type PriorityItem, type ReportInput } from "./generate";
import { isUnlimitedQuota } from "@/lib/api/quota";
import { effectiveLimit } from "@/lib/billing/entitlement";

export type StoredReport = { id: string; report: unknown; isFallback: boolean; createdAt: string; promptVersion: string };

/** PostgREST/Postgres "sütun yok" kodları: migration 0009 bu ortamda henüz uygulanmamış. */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);
const isMissingColumn = (e: { code?: string } | null | undefined) => Boolean(e?.code && MISSING_COLUMN_CODES.has(e.code));

const BASE_COLUMNS = "id, status, overall, potential, subscores, gains, observations, flags, geometry";

export async function getLatestReport(userId: string, analysisId: string): Promise<StoredReport | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("coach_reports")
    .select("id, report, is_fallback, created_at, prompt_version")
    .eq("user_id", userId)
    .eq("analysis_id", analysisId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { id: String(data.id), report: data.report, isFallback: Boolean(data.is_fallback), createdAt: String(data.created_at), promptVersion: String(data.prompt_version) };
}

/**
 * hybrid.v1 satırının imzalı sinyallerinden rapora giden kısım (engine spec §9.6). Saf; birim testi var.
 * Eski satır veya ayrıştırılamayan sinyal → öncelik yok, değerlendirilmeyen alan yok (eski davranış).
 * Etiket messages/tr.json analysis.levers.*, katalog kimlikleri content/levers.ts LEVERS.
 */
export function reportSignals(row: { engine_version?: string | null; signals?: unknown }): { notAssessed: NotAssessed[]; priorities: PriorityItem[] } {
  if (row.engine_version !== "hybrid.v1") return { notAssessed: [], priorities: [] };
  const s = ClientSignals.safeParse(row.signals);
  if (!s.success) return { notAssessed: [], priorities: [] };
  return { notAssessed: s.data.notAssessed, priorities: s.data.improveFirst.map(toPriority) };
}

function toPriority(i: ImproveItem): PriorityItem {
  const lever = LEVERS[i.lever];
  return {
    sub: i.sub,
    lever: i.lever,
    label: tr.analysis.levers[i.lever],
    gain: i.gain,
    catalogIds: [...lever.steps],
    ...(lever.presets ? { presets: lever.presets } : {}),
  };
}

type AnalysisRow = {
  id: string;
  status: string;
  overall: number | string | null;
  potential: number | string | null;
  subscores: unknown;
  gains: unknown;
  observations: unknown;
  flags: unknown;
  geometry: unknown;
  engine_version?: string | null;
  signals?: unknown;
};

/** engine_version ve signals ile okur; migration 0009 uygulanmamış ortamda eski sütunlarla (eski davranış). */
async function loadAnalysis(admin: ReturnType<typeof createAdminClient>, userId: string, analysisId: string): Promise<AnalysisRow | null> {
  const full = await admin.from("analyses").select(`${BASE_COLUMNS}, engine_version, signals`).eq("id", analysisId).eq("user_id", userId).maybeSingle();
  if (!isMissingColumn(full.error)) return (full.data as AnalysisRow | null) ?? null;
  const legacy = await admin.from("analyses").select(BASE_COLUMNS).eq("id", analysisId).eq("user_id", userId).maybeSingle();
  return (legacy.data as AnalysisRow | null) ?? null;
}

/** Rapor üret ve kaydet (SPEC Faz 9 madde 4). regenerate için hak: 1 + reportRegens. */
export async function createReport(userId: string, analysisId: string, regenerate: boolean): Promise<StoredReport> {
  const admin = createAdminClient();
  const a = await loadAnalysis(admin, userId, analysisId);
  if (!a || a.status !== "completed") throw new ApiError("BAD_INPUT", "Tamamlanmış analiz bulunamadı.");

  const { count } = await admin.from("coach_reports").select("id", { count: "exact", head: true }).eq("analysis_id", analysisId);
  const existing = count ?? 0;
  if (existing > 0 && !regenerate) {
    const latest = await getLatestReport(userId, analysisId);
    if (latest) return latest;
  }
  if (existing > effectiveLimit(ENTITLEMENTS.premium.reportRegens, await isUnlimitedQuota(admin, userId))) throw new ApiError("QUOTA_EXCEEDED", "Yeniden üretim hakkın doldu.");

  const { data: profile } = await admin.from("profiles").select("questionnaire").eq("id", userId).maybeSingle();
  const q = QuestionnaireSchema.safeParse(profile?.questionnaire);
  if (!q.success) throw new ApiError("BAD_INPUT", "Anket eksik; rapor için önce anketi tamamla.");

  // engine spec §9.2: üretimde Claude koçu, hukuki onay ve ölçüm durumu tamamlanmadan açılmaz (AI_FAILED).
  assertEngineReady(process.env, { status: ENGINE_STATUS, path: "coach" });

  const geometry = a.geometry as GeometryResult | null;
  const flags = a.flags as { visibleSkinConcern?: boolean; skinConcernNote?: string | null } | null;
  const { notAssessed, priorities } = reportSignals(a);
  const gen = await generateCoachReport({
    overall: Number(a.overall),
    potential: Number(a.potential),
    subscores: (a.subscores ?? {}) as Record<string, number>,
    gains: (a.gains ?? {}) as ReportInput["gains"],
    observations: (a.observations ?? {}) as Record<string, string>,
    flags: { visibleSkinConcern: Boolean(flags?.visibleSkinConcern), skinConcernNote: flags?.skinConcernNote ?? null },
    faceShape: geometry?.faceShape ?? { primary: "oval", confidence: 0 },
    questionnaire: q.data,
    notAssessed,
    priorities,
  });

  const row = {
    user_id: userId,
    analysis_id: analysisId,
    model: gen.model,
    prompt_version: gen.promptVersion,
    report: gen.report,
    is_fallback: gen.isFallback,
    safety_flags: gen.safetyFlags, // yalnız kural adları
    input_tokens: gen.inputTokens,
    output_tokens: gen.outputTokens,
  };
  let inserted = await admin.from("coach_reports").insert({ ...row, ai_usage: gen.aiUsage }).select("id, created_at").single();
  // migration 0009 uygulanmamışsa ai_usage sütunu yok: maliyet yalnız token sütunlarında kalır.
  if (isMissingColumn(inserted.error)) inserted = await admin.from("coach_reports").insert(row).select("id, created_at").single();
  if (inserted.error || !inserted.data) throw new Error("coach_reports insert failed");
  return { id: String(inserted.data.id), report: gen.report, isFallback: gen.isFallback, createdAt: String(inserted.data.created_at), promptVersion: gen.promptVersion };
}
