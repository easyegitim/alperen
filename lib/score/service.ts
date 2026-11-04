import "server-only";

import type { ObservationProvider } from "@/lib/ai/observeProvider";
import { getScoringProvider, type ScoringProvider } from "@/lib/ai/provider";
import { SCORE_PROMPT_VERSION, buildScorePrompt } from "@/lib/ai/prompts/score.v1";
import type { ScoreOutput } from "@/lib/ai/scoreSchema";
import { ApiError } from "@/lib/api/errors";
import { assertEngineReady, getAiEnv } from "@/lib/config/ai.server";
import { ENGINE_STATUS } from "@/lib/config/engine.server";
import { SCORE_CALLS, SCORE_CALL_TIMEOUT_MS, getScoringEnv } from "@/lib/config/scoring";
import { SUB_KEYS, type SubKeyV1 } from "@/lib/config/teaser";
import type { GeometryResult } from "@/lib/face/types";
import { QuestionnaireSchema, deriveContext, type Questionnaire } from "@/lib/questionnaire";
import { aggregateScores, type Aggregated } from "./aggregate";
import { calibrate, type CalibrationVersion } from "./calibration";
import { classifyFaceShape } from "@/lib/face/faceShape";
import { checkServerCapture, withServerFaceShape } from "./engine/captureGate";
import type { ScoreV2Context } from "./engine/scoreV2";
import { scoreHybrid, type AiUsage, type HybridContext, type HybridScored, type SignalsV1 } from "./engine";
import { computePotential } from "./potential";

export type { AiUsage, HybridContext, SignalsV1 };
export type ScoreEngineName = "legacy" | "hybrid.v1" | "hybrid.v2";
type Env = Record<string, string | undefined>;

export type ScoringContext = {
  presentation: Questionnaire["presentation"];
  bodyFatContextAllowed: boolean;
  beardOption: boolean;
};

export type ScoredAnalysis = {
  subscores: Record<SubKeyV1, number>;
  rawSubscores: Record<SubKeyV1, number>;
  rawOverall: number;
  overall: number;
  potential: number;
  gains: Aggregated["gains"];
  /** legacy: modelin serbest metin gözlemleri; hybrid.v1: yalnız skin, hair, brows, facialHair kod cümleleri. */
  observations: Record<string, string>;
  flags: ScoreOutput["flags"];
  samples: number;
  model: string;
  promptVersion: string;
  calibrationVersion: CalibrationVersion;
};

/** SPEC 8.2: N paralel çağrı (temperature 0) → medyan → kalibrasyon → potansiyel. Saf hesap; DB yok. */
export async function scoreImage(
  imageBase64: string,
  geometry: GeometryResult,
  ctx: ScoringContext,
  provider: ScoringProvider = getScoringProvider(),
  calls = SCORE_CALLS,
): Promise<ScoredAnalysis> {
  const prompt = buildScorePrompt({ presentation: ctx.presentation, geometry, bodyFatContextAllowed: ctx.bodyFatContextAllowed });
  const controller = new AbortController();
  // Bütçe: çağrı başına zaman aşımı × (1 + tekrar) + beklemeler + yedek model denemesi.
  const timer = setTimeout(() => controller.abort(), SCORE_CALL_TIMEOUT_MS * 2 + 10_000);
  let settled: PromiseSettledResult<ScoreOutput>[];
  try {
    settled = await Promise.allSettled(Array.from({ length: calls }, () => provider.scoreOnce(imageBase64, prompt, controller.signal)));
  } finally {
    clearTimeout(timer);
  }
  const agg = aggregateScores(settled);
  const version = getScoringEnv().calibrationVersion as CalibrationVersion;

  const subscores = Object.fromEntries(SUB_KEYS.map((k) => [k, calibrate(agg.rawSubscores[k], version, { sub: k })])) as Record<SubKeyV1, number>;
  const overall = calibrate(agg.rawOverall, version);
  const potential = computePotential({
    rawSubscores: agg.rawSubscores,
    gains: agg.gains,
    overall,
    bodyFatContextAllowed: ctx.bodyFatContextAllowed,
    beardOption: ctx.beardOption,
    calibrate: (raw) => calibrate(raw, version),
  });

  return {
    subscores,
    rawSubscores: agg.rawSubscores,
    rawOverall: Math.round(agg.rawOverall * 100) / 100,
    overall,
    potential,
    gains: agg.gains,
    observations: agg.observations,
    flags: agg.flags,
    samples: agg.samples,
    model: provider.lastModel ?? provider.model,
    promptVersion: SCORE_PROMPT_VERSION,
    calibrationVersion: version,
  };
}

// ── Motor seçimi (engine spec §1.2, iz E) ────────────────────────────────────────────────────────────────────────

/** Rota ve betiklerin satıra yazdığı tam sonuç: legacy'de motor alanları null; geometry satıra yazılacak olandır. */
export type AnalysisScore = ScoredAnalysis & {
  engineVersion: "hybrid.v1" | null;
  signals: SignalsV1 | null;
  aiUsage: AiUsage | null;
  /** hybrid.v1: faceShape sunucuda yeniden hesaplanmış (face_shape sütunuyla aynı, §3.6); legacy: istemcinin geometrisi. */
  geometry: GeometryResult;
};

/** legacy ScoringContext + motor bağlamı. Yapısal skora bunların hiçbiri girmez (scoreStructural bağlam almaz). */
export type AnalysisContext = ScoringContext & HybridContext;

/** Anketten skor bağlamı. Anket yoksa/bozuksa en temkinli varsayılanlar: sakal ve beden bağlamı kapalı, başörtüsü yok. */
export function analysisContextFromQuestionnaire(raw: unknown, profile?: { presentation?: string | null }): AnalysisContext {
  // Sunum tek kaynak profiles.presentation (0010); anket değeri yalnız eski kayıtlar için yedek (CONTRACTS_V2 §5).
  const fromProfile = profile?.presentation === "male" || profile?.presentation === "female" || profile?.presentation === "unspecified" ? profile.presentation : undefined;
  const q = QuestionnaireSchema.safeParse(raw);
  if (!q.success) {
    return { presentation: fromProfile ?? "unspecified", bodyFatContextAllowed: false, beardOption: false, headCovering: false, beardPreference: "none" };
  }
  return {
    presentation: fromProfile ?? q.data.presentation,
    bodyFatContextAllowed: deriveContext(q.data).bodyFatContextAllowed,
    beardOption: q.data.beardPreference !== "none",
    headCovering: q.data.headCovering,
    beardPreference: q.data.beardPreference,
  };
}

export type PreparedScoring = { engine: ScoreEngineName; geometry: GeometryResult };

/**
 * hybrid.v2 ön kontrolü (reserve/promote'tan önce; fırlatırsa hak düşmez): üretim koruması, ANTHROPIC_API_KEY varlığı,
 * yüz şeklinin sunucu hesabı. Poz/ışık/netlik kapısı YOK (KB §3.1/6: kötü fotoğrafta uyarı, engel yok; W1 pop-up'ı).
 */
export function prepareScoringV2(geometry: GeometryResult, env: Env = process.env): PreparedScoring {
  assertEngineReady(env, { status: ENGINE_STATUS, path: "score" });
  if (!env.ANTHROPIC_API_KEY?.trim()) {
    console.warn("[engine.v2] config_error missing ANTHROPIC_API_KEY");
    throw new ApiError("AI_FAILED", "Analiz servisi yapılandırılmamış; hakkın düşmedi.");
  }
  return { engine: "hybrid.v2", geometry: withServerFaceShape(geometry, classifyFaceShape(geometry.metrics)) };
}

/** Ödeme öncesi/sonrası profil satırından motor bağlamı (yaş bandı ve sunum kullanıcı beyanıdır; çıkarım yok). */
export function analysisContextV2(profile: { age_band?: string | null; presentation?: string | null; questionnaire?: unknown; face_shape_override?: string | null } | null | undefined): ScoreV2Context {
  const legacy = analysisContextFromQuestionnaire(profile?.questionnaire, profile ?? undefined);
  const band = profile?.age_band;
  const ageBand = band === "under_18" || band === "18_24" || band === "25_34" || band === "35_49" || band === "50_plus" ? band : null;
  const o = profile?.face_shape_override;
  const faceShapeOverride = o === "oval" || o === "round" || o === "square" || o === "long" || o === "heart" || o === "diamond" ? o : null;
  return { ageBand, presentation: legacy.presentation, headCoveringDeclared: legacy.headCovering, faceShapeOverride };
}

/**
 * reserve_analysis'ten ÖNCE çağrılır; fırlatırsa hak düşmez ve satır oluşmaz.
 * legacy: hiçbir şey değişmez (dağıtım davranış nötr). hybrid.v1: üretim koruması (§9.2), sağlayıcı anahtarı var mı
 * (yoksa açık AI_FAILED; sahte başarı yok), sunucu çekim kapısı (CAPTURE_QUALITY 422) ve faceShape'in sunucu hesabı.
 */
export function prepareScoring(geometry: GeometryResult, env: Env = process.env): PreparedScoring {
  const ai = getAiEnv(env);
  if (ai.scoreEngine === "legacy") return { engine: "legacy", geometry };
  if (ai.scoreEngine === "hybrid.v2") return prepareScoringV2(geometry, env);

  assertEngineReady(env, { status: ENGINE_STATUS, path: "score" });
  // Yalnız varlık kontrolü; değer okunmaz, loglanmaz (anahtar yalnız lib/ai/anthropic.ts ve sağlayıcıda kullanılır).
  const keyName = ai.observeProvider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
  if (!env[keyName]?.trim()) {
    console.warn(`[engine] config_error missing ${keyName}`);
    throw new ApiError("AI_FAILED", "Analiz servisi yapılandırılmamış; hakkın düşmedi.");
  }
  const gate = checkServerCapture(geometry);
  if (!gate.ok) throw new ApiError("CAPTURE_QUALITY", `capture_${gate.reason}`);
  return { engine: "hybrid.v1", geometry: withServerFaceShape(geometry, gate.faceShape) };
}

export type ScoreAnalysisOptions = {
  /** prepareScoring'in seçtiği motor; verilmezse SCORE_ENGINE okunur. */
  engine?: ScoreEngineName;
  env?: Env;
  /** Testler için (ağ yok). */
  scoringProvider?: ScoringProvider;
  observationProvider?: ObservationProvider;
  /** hybrid.v1: başarıda ve hatada bir kez çağrılır (rota başarısız satıra da ai_usage yazar). */
  onUsage?: (u: AiUsage) => void;
};

/**
 * SCORE_ENGINE'e göre skorlama: legacy = Gemini sayısal skor (scoreImage, değişmedi); hybrid.v1 = Claude enum gözlemleri
 * + koddaki deterministik skor (scoreHybrid). Claude'dan asla sayı istenmez: sayısal ScoringProvider'ın Claude sürümü yok.
 */
export async function scoreAnalysis(
  imageBase64: string,
  geometry: GeometryResult,
  ctx: AnalysisContext,
  opts: ScoreAnalysisOptions = {},
): Promise<AnalysisScore> {
  const env = opts.env ?? process.env;
  const engine = opts.engine ?? getAiEnv(env).scoreEngine;
  if (engine === "legacy") {
    const scored = await scoreImage(imageBase64, geometry, ctx, opts.scoringProvider ?? getScoringProvider());
    return { ...scored, engineVersion: null, signals: null, aiUsage: null, geometry };
  }
  // hybrid.v2 eşzamanlı yol değildir: rota arka plan işini (lib/score/engine/jobs.ts) başlatır.
  if (engine === "hybrid.v2") throw new ApiError("AI_FAILED", "hybrid_v2_requires_job");

  // Doğrudan çağrılarda da (betikler) aynı kapı; rota bunu zaten reserve'den önce çalıştırdı (saf, idempotent).
  const gate = checkServerCapture(geometry);
  if (!gate.ok) throw new ApiError("CAPTURE_QUALITY", `capture_${gate.reason}`);
  const g = withServerFaceShape(geometry, gate.faceShape);
  const hybridCtx: HybridContext = { headCovering: ctx.headCovering, presentation: ctx.presentation, beardPreference: ctx.beardPreference };
  const h = await scoreHybrid(imageBase64, g, hybridCtx, opts.observationProvider, { onUsage: opts.onUsage });
  return fromHybrid(h, g);
}

/** HybridScored → satır biçimi (saf). */
export function fromHybrid(h: HybridScored, geometry: GeometryResult): AnalysisScore {
  return {
    subscores: h.subscores,
    rawSubscores: h.rawSubscores,
    rawOverall: h.rawOverall,
    overall: h.overall,
    potential: h.potential,
    gains: h.gains,
    observations: h.observations,
    flags: h.flags,
    samples: h.samples,
    model: h.model,
    promptVersion: h.promptVersion,
    calibrationVersion: h.calibrationVersion,
    engineVersion: h.engineVersion,
    signals: h.signals,
    aiUsage: h.aiUsage,
    geometry,
  };
}
