import "server-only";

import type { LabeledImage } from "@/lib/ai/provider";
import { ApiError } from "@/lib/api/errors";
import { ENGINE_H2, SET_CACHE_SECRET_ENV } from "@/lib/config/engine.h2.server";
import type { GeometryResult } from "@/lib/face/types";
import { SECTION_KEYS, type AnalysisFailure, type SectionKey } from "@/lib/score/contract";
import { computeSetKey } from "@/lib/score/setKey";
import type { AnalysisRepo } from "./repo";
import { scoreV2, type ScoreV2Context, type ScoreV2Options } from "./scoreV2";
import { cachedSignals, readCachedScores, toCachedScores } from "./setCache";
import type { AiUsage } from "./types";
import type { SectionPatchV2 } from "./typesV2";

// Arka plan işi (PLAN_V2 3a; CONTRACTS_V2 §2.3): queued → running → kartlar hazır oldukça sections_ready → completed;
// hata → failed + signals.failure (hak düşmez: kota failed saymaz; istemci görselleri yeniden gönderir).
// Görseller yalnız bu çağrının belleğinde (after()/waitUntil); hiçbir yere yazılmaz. Set önbelleği: aynı set 1 yıl.

export type JobArgs = {
  repo: AnalysisRepo;
  analysisId: string;
  userId: string;
  images: readonly LabeledImage[];
  sourceHashes: readonly string[] | null;
  geometry: GeometryResult;
  context: ScoreV2Context;
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** Test: sahte sağlayıcılar. */
  engine?: Pick<ScoreV2Options, "provider" | "auditProvider" | "auditTimeoutMs">;
};

export type JobResult = { status: "completed"; cacheHit: boolean } | { status: "failed"; failure: AnalysisFailure };

/** Bu süre ilerleme olmayan running/queued satır takılı sayılır; istemci yeniden gönderebilir (retry-on-stale). */
export const JOB_STALE_MS = 10 * 60_000;

const RETRYABLE: Record<AnalysisFailure["code"], boolean> = { AI_FAILED: true, AI_TIMEOUT: true, AI_SAFETY_BLOCKED: false, NO_FACE: true, CAPTURE_QUALITY: true };

export function failureOf(e: unknown): AnalysisFailure {
  const code = e instanceof ApiError && (e.code === "AI_TIMEOUT" || e.code === "AI_SAFETY_BLOCKED" || e.code === "NO_FACE" || e.code === "CAPTURE_QUALITY") ? e.code : "AI_FAILED";
  return { code, retryable: RETRYABLE[code] };
}

function usageOf(e: unknown): AiUsage | null {
  return typeof e === "object" && e !== null && "aiUsage" in e ? ((e as { aiUsage?: AiUsage }).aiUsage ?? null) : null;
}

/** Satır zaten bir iş tarafından ilerletiliyor mu (takılı değil)? */
export function isJobStale(row: { status: string; created_at: string; signals?: unknown }, nowMs: number, staleMs: number = JOB_STALE_MS): boolean {
  if (row.status !== "queued" && row.status !== "running") return false;
  const progressAt = typeof row.signals === "object" && row.signals !== null && "progressAt" in row.signals ? (row.signals as { progressAt?: unknown }).progressAt : undefined;
  const last = typeof progressAt === "string" ? Date.parse(progressAt) : Date.parse(row.created_at);
  return !Number.isFinite(last) || nowMs - last > staleMs;
}

export async function runAnalysisJob(args: JobArgs): Promise<JobResult> {
  const { repo, analysisId } = args;
  const now = args.now ?? Date.now;
  const env = args.env ?? process.env;
  const iso = () => new Date(now()).toISOString();
  const ready: SectionKey[] = ["device"];
  const setKey = computeSetKey(env[SET_CACHE_SECRET_ENV], args.sourceHashes);

  try {
    await repo.updateAnalysis(analysisId, { status: "running", engine_version: ENGINE_H2.version, set_key: setKey, signals: { engine: "hybrid.v2", v: 2, progressAt: iso() } });

    // Set önbelleği (Ç11): aynı set → saklı sonuç, model çağrısı yok.
    if (setKey) {
      const hit = await repo.lookupSet(setKey, iso());
      const cached = hit ? readCachedScores(hit.scores) : null;
      if (hit && cached) {
        await repo.updateAnalysis(analysisId, {
          status: "completed",
          overall: cached.overall,
          potential: cached.potential,
          subscores: cached.subscores,
          score_range: cached.score_range,
          percentile: cached.percentile,
          face_shape: cached.face_shape,
          gains: cached.gains,
          observations: cached.observations,
          signals: cachedSignals(cached, iso()),
          runs: null,
          calibration_version: hit.calibration_version,
          prompt_version: hit.prompt_version,
          engine_version: ENGINE_H2.version,
          scoring_model: hit.model,
          ai_usage: { calls: 0, attempts: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, estUsd: 0, servedModels: [] },
          sections_ready: [...SECTION_KEYS],
          completed_at: iso(),
        });
        await repo.insertReport({ user_id: args.userId, analysis_id: analysisId, model: hit.model, prompt_version: "report.v3", report: cached.report, is_fallback: false, safety_flags: [], input_tokens: 0, output_tokens: 0, ai_usage: null });
        return { status: "completed", cacheHit: true };
      }
    }

    const onSection = async (section: SectionKey, patch: SectionPatchV2) => {
      if (!ready.includes(section)) ready.push(section);
      const { report, signals, ...columns } = patch;
      if (section === "report") return; // coach_reports aşağıda, tamamlanmayla birlikte
      await repo.updateAnalysis(analysisId, { ...columns, ...(signals ? { signals: { ...signals, progressAt: iso() } } : {}), sections_ready: [...ready] });
      void report;
    };
    const scored = await scoreV2({ images: args.images, geometry: args.geometry, context: args.context }, { ...args.engine, env, now, onSection });

    await repo.insertReport({
      user_id: args.userId,
      analysis_id: analysisId,
      model: scored.model,
      prompt_version: "report.v3",
      report: scored.report,
      is_fallback: scored.signals.audit.fallbacks > 0,
      safety_flags: scored.signals.audit.flags,
      input_tokens: scored.aiUsage.input + scored.aiUsage.cacheRead + scored.aiUsage.cacheWrite,
      output_tokens: scored.aiUsage.output,
      ai_usage: scored.aiUsage,
    });
    await repo.updateAnalysis(analysisId, {
      status: "completed",
      overall: scored.overall,
      potential: scored.potential,
      subscores: scored.subscores,
      score_range: scored.scoreRange,
      percentile: scored.percentile,
      face_shape: scored.faceShape,
      gains: scored.gains,
      observations: scored.observations,
      signals: { ...scored.signals, progressAt: iso() },
      runs: scored.runs,
      calibration_version: scored.calibrationVersion,
      prompt_version: scored.promptVersion,
      engine_version: scored.engineVersion,
      scoring_model: scored.model,
      ai_usage: scored.aiUsage,
      sections_ready: [...SECTION_KEYS],
      completed_at: iso(),
    });
    if (setKey) {
      await repo.storeSet({ set_key: setKey, user_id: args.userId, scores: toCachedScores(scored), model: scored.model, prompt_version: scored.promptVersion, calibration_version: scored.calibrationVersion });
    }
    return { status: "completed", cacheHit: false };
  } catch (e) {
    const failure = failureOf(e);
    const aiUsage = usageOf(e);
    console.warn(`[engine.v2] job_failed code=${failure.code} ${e instanceof Error ? e.name : "error"}`);
    try {
      await repo.updateAnalysis(analysisId, {
        status: "failed",
        signals: { engine: "hybrid.v2", v: 2, failure, progressAt: iso() },
        ...(aiUsage ? { ai_usage: aiUsage } : {}),
        completed_at: iso(),
      });
    } catch (e2) {
      console.error(`[engine.v2] failed_update_failed ${e2 instanceof Error ? e2.name : "error"}`);
    }
    return { status: "failed", failure };
  }
}
