import "server-only";

import { getAuditProvider, type AuditProvider as AuditProviderImpl } from "@/lib/ai/audit";
import { getScoringProviderV2, type LabeledImage, type ScoreSampleV2, type ScoringProviderV2 } from "@/lib/ai/provider";
import { SCORE_V2_PROMPT_VERSION, buildScoreV2UserText, type AgeBand, type Presentation } from "@/lib/ai/prompts/score.v2";
import type { ScoreOutputV2 } from "@/lib/ai/scoreSchema.v2";
import { ApiError } from "@/lib/api/errors";
import { ZERO_USAGE, addTokenUsage, estUsd, getAiEnv, type TokenUsage } from "@/lib/config/ai.server";
import { BANDS } from "@/lib/config/engine.server";
import { ENGINE_H2, STRUCTURAL_SUBS_H2, getCalibrationH2, getStructuralSource } from "@/lib/config/engine.h2.server";
import { SUB_KEYS_V2, type SubKey } from "@/lib/config/teaser";
import type { FaceShape, GeometryResult } from "@/lib/face/types";
import { REGION_KEYS, type ExplanationV2, type ReportV3, type SectionKey } from "@/lib/score/contract";
import { deviceResultFromGeometry } from "@/lib/score/present";
import { auditTexts, type AuditText } from "./audit";
import { blendStructural, structuralFromGeometry, type StructuralSub } from "./blend";
import { calibrateH2, calibrationSlope, percentileH2, rangeAround } from "./calibrationH2";
import { collectRuns, consensus, vectorOf, type RunVector } from "./consensus";
import { buildExplanation, computePotentialH2, improveFirstV2, subGains, truncate, weightedOverall, weightsH2 } from "./explain";
import { reconcileFaceShape } from "./faceShapeV2";
import { planStepsForPrompt } from "./planSteps";
import { REGION_NAMES_TR, STRUCTURAL_REGIONS, TEMPLATES } from "./templates";
import type { AiUsage } from "./types";
import type { ObservationsV2, ScoreRangesV2, ScoredV2, SectionPatchV2, SignalsV2 } from "./typesV2";

// hybrid.v2 ("claude-rubric") motoru (PLAN_V2 Faz 3; KB §4): tüm açılar tek mesajda → 3 çalıştırma (gerekirse 4) →
// alt skor bazında ortanca → yapısal üçlüde geometri harmanı → kalibrasyon h2 → potansiyel (K2) → açıklamalar (§4.9)
// → yüz şekli uzlaştırma (Ç8) → rapor v3 (§5) → denetim + güvenlik → kart kart teslim (onSection).
// Görsel yalnız bu çağrının belleğinde; görsel, istem, çıktı loglanmaz. Herkes için aynı kurallar (K1).

export type ScoreV2Context = {
  ageBand: AgeBand | null;
  presentation: Presentation;
  /** Kullanıcı beyanı (anket) — fotoğraftan tespitle birleşir; saç hariç tutma (K9). */
  headCoveringDeclared: boolean;
  faceShapeOverride: FaceShape | null;
};

export type ScoreV2Input = { images: readonly LabeledImage[]; geometry: GeometryResult; context: ScoreV2Context };

export type ScoreV2Options = {
  provider?: ScoringProviderV2;
  /** null: denetim çağrısı yapılmaz (yalnız güvenlik filtresi). */
  auditProvider?: AuditProviderImpl | null;
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** Bölüm hazır olunca çağrılır (sıra: overall, subscores, potential, faceShape, explanations, improveFirst, report). */
  onSection?: (section: SectionKey, patch: SectionPatchV2) => Promise<void> | void;
  auditTimeoutMs?: number;
};

export const AUDIT_TIMEOUT_MS = 40_000;
const LIMITS = { letter: 900, region: 300, seen: 400, closing: 600, skinSurface: 200, line: 200 } as const;
const CLOSING_SUFFIX = "Tıbbi tavsiye değildir.";

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

function majority<T extends string | boolean>(values: readonly T[], fallback: T): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = fallback;
  let n = -1;
  for (const [v, c] of counts) {
    if (c > n) {
      best = v;
      n = c;
    }
  }
  return best;
}

function failureFromRuns(samples: number, reasons: readonly string[], requested: number): ApiError {
  const refusals = reasons.filter((r) => r === "refusal").length;
  console.warn(`[engine.v2] quorum_lost ok=${samples} reasons=${reasons.join(",")}`);
  if (refusals >= Math.min(2, requested)) return new ApiError("AI_SAFETY_BLOCKED", "score_refusal");
  if (reasons.length > 0 && reasons.every((r) => r === "timeout")) return new ApiError("AI_TIMEOUT", "score_timeout");
  return new ApiError("AI_FAILED", "score_quorum");
}

function summarizeUsage(calls: number, attempts: number, byModel: Map<string, TokenUsage>): AiUsage {
  let total = ZERO_USAGE;
  let usd = 0;
  for (const [model, u] of byModel) {
    total = addTokenUsage(total, u);
    usd += estUsd(u, model);
  }
  return { calls, attempts, input: total.input, output: total.output, cacheRead: total.cacheRead, cacheWrite: total.cacheWrite5m + total.cacheWrite1h, estUsd: Math.round(usd * 1e6) / 1e6, servedModels: [...byModel.keys()].sort() };
}

/** Dengeli aralık çubuğu (KB §5/3): yalnız motor yapılandırmasında bandı olan oranlar (ceza bandının sıfır bölgesi). */
export function measuresFromGeometry(g: GeometryResult): ReportV3["measures"] {
  const tilt = BANDS.tilt.band;
  const jaw = BANDS.jawWidth.band;
  const out: ReportV3["measures"] = [];
  if (tilt.kind === "twoSided") out.push({ key: "canthalTiltDeg", value: round2(g.metrics.canthalTiltDeg), balancedRange: [round2(tilt.c - tilt.h), round2(tilt.c + tilt.h)] });
  if (jaw.kind === "twoSided") out.push({ key: "jawRatio", value: round2(g.metrics.jawRatio), balancedRange: [round2(jaw.c - jaw.h), round2(jaw.c + jaw.h)] });
  return out;
}

type RegionDraft = { key: ReportV3["regions"][number]["key"]; strength: string; seen: string; improvements: string[] };

/** Dokuz bölge, sözleşme sırasında; eksik bölge şablonla dolar; tekrar eden anahtar ilkiyle kalır. */
function draftRegions(out: ScoreOutputV2): RegionDraft[] {
  const byKey = new Map<string, ScoreOutputV2["report"]["regions"][number]>();
  for (const r of out.report.regions) if (!byKey.has(r.key)) byKey.set(r.key, r);
  return REGION_KEYS.map((key) => {
    const r = byKey.get(key);
    return {
      key,
      strength: truncate(r?.strength ?? "", LIMITS.region) || TEMPLATES.regionStrength(key),
      seen: truncate(r?.seen ?? "", LIMITS.seen) || TEMPLATES.regionSeen(key),
      improvements: (r?.improvements ?? []).map((s) => truncate(s, LIMITS.region)).filter(Boolean).slice(0, 2),
    };
  });
}

function closingWith(text: string, seeProfessional: string | null): string {
  let c = truncate(text, LIMITS.closing) || TEMPLATES.closing;
  if (seeProfessional) c = truncate(`${seeProfessional} ${c}`, LIMITS.closing);
  if (!c.includes(CLOSING_SUFFIX)) c = truncate(`${c} ${CLOSING_SUFFIX}`, LIMITS.closing + CLOSING_SUFFIX.length + 1);
  return c;
}

export async function scoreV2(input: ScoreV2Input, opts: ScoreV2Options = {}): Promise<ScoredV2> {
  const env = opts.env ?? process.env;
  const ai = getAiEnv(env);
  const provider = opts.provider ?? getScoringProviderV2(ai);
  const auditProvider = opts.auditProvider === undefined ? getAuditProvider(ai) : opts.auditProvider;
  const cal = getCalibrationH2(env);
  const source = getStructuralSource(env);
  const now = opts.now ?? Date.now;
  const emit = async (section: SectionKey, patch: SectionPatchV2) => {
    await opts.onSection?.(section, patch);
  };
  const { geometry, context } = input;
  const views = input.images.map((i) => i.view);
  const device = deviceResultFromGeometry(geometry);

  // 1) Çalıştırmalar (ortanca-3, gerekirse 4).
  const userText = buildScoreV2UserText({
    ageBand: context.ageBand,
    presentation: context.presentation,
    device,
    views,
    planSteps: planStepsForPrompt({ hairAllowed: !context.headCoveringDeclared, beardAllowed: context.presentation !== "female" }),
  });
  const run = await collectRuns(provider, input.images, userText, { now });
  const usage = summarizeUsage(run.samples.length, run.attempts, run.usageByModel);
  if (run.fatal) {
    console.warn(`[engine.v2] ${run.fatal.reason === "too_large" ? "pipeline_bug too_large" : "config_error"} status=${run.fatal.status ?? "-"}`);
    throw Object.assign(run.fatal.reason === "too_large" ? new ApiError("IMAGE_TOO_LARGE", "score_too_large") : new ApiError("AI_FAILED", "score_config_error"), { aiUsage: usage });
  }
  if (run.samples.length < 2) throw Object.assign(failureFromRuns(run.samples.length, run.reasons, 3), { aiUsage: usage });
  const badFace = run.samples.filter((s) => s.out.photo.faceCount !== "one").length;
  if (badFace * 2 >= run.samples.length) throw Object.assign(new ApiError("NO_FACE", "score_no_single_face"), { aiUsage: usage });

  // 2) Ortanca ve metin çalıştırması.
  const vectors: RunVector[] = run.samples.map(vectorOf);
  const cons = consensus(vectors);
  const textRun: ScoreSampleV2 = run.samples[cons.nearest];
  const out = textRun.out;
  const headCoveringDetected = majority(run.samples.map((s) => s.out.headCoveringDetected), false);
  const glassesDetected = majority(run.samples.map((s) => s.out.glassesDetected), false);
  const hairExcluded = context.headCoveringDeclared || headCoveringDetected || out.notAssessed.some((n) => n.sub === "hair" && n.reason === "excluded");
  const excluded = new Set<SubKey>(hairExcluded ? ["hair"] : []);
  const notAssessed = [
    ...(hairExcluded ? [{ sub: "hair" as const, reason: "excluded" as const }] : []),
    ...out.notAssessed.filter((n) => !(n.sub === "hair" && hairExcluded) && n.reason === "not_visible").map((n) => ({ sub: n.sub, reason: n.reason })),
  ];

  // 3) Yapısal harman (claude | geometry | blend).
  const beardOverJaw = out.observations.facialHair === "short_beard" || out.observations.facialHair === "full_beard";
  const geometryStructural = structuralFromGeometry(geometry, { beardOverJaw });
  const claudeStructural = Object.fromEntries(STRUCTURAL_SUBS_H2.map((s) => [s, round3(cons.median[s])])) as Record<StructuralSub, number>;
  const structuralUsed = {} as Record<StructuralSub, typeof source>;
  const raw = { ...cons.median } as Record<SubKey, number>;
  for (const s of STRUCTURAL_SUBS_H2) {
    const b = blendStructural(cons.median[s], geometryStructural[s], source);
    raw[s] = b.value;
    structuralUsed[s] = b.used;
  }
  const rawRounded = Object.fromEntries(SUB_KEYS_V2.map((k) => [k, round3(raw[k])])) as Record<SubKey, number>;

  // 4) Ağırlık, genel, kalibrasyon, aralık, yüzdelik, potansiyel.
  const weights = weightsH2({ hairExcluded });
  const rawOverall = weightedOverall(raw, weights);
  const overall = calibrateH2(rawOverall, cal);
  const percentile = percentileH2(rawOverall);
  const subscores = Object.fromEntries(SUB_KEYS_V2.map((k) => [k, excluded.has(k) ? null : calibrateH2(raw[k], cal)])) as Record<SubKey, number | null>;
  const gains = subGains(out, excluded);
  const { potential } = computePotentialH2({ raw, gains, weights, overall, calibrate: (r) => calibrateH2(r, cal) });
  const scoreRange: ScoreRangesV2 = {
    overall: rangeAround(overall, cal),
    potential: rangeAround(potential, cal),
    subscores: Object.fromEntries(SUB_KEYS_V2.filter((k) => subscores[k] !== null).map((k) => [k, rangeAround(subscores[k] as number, cal)])),
  };
  const slope = calibrationSlope(cal);

  const servedModels = usage.servedModels;
  const fallbackModel = servedModels.find((m) => m !== provider.model);
  const model = run.samples.some((s) => s.fallbackServed) ? `${provider.model}+fallback:${fallbackModel ?? "unknown"}` : provider.model;
  const baseSignals = (): Omit<SignalsV2, "explanations" | "improveFirst" | "faceShapeDetailed" | "audit" | "observations"> => ({
    engine: "hybrid.v2",
    v: 2,
    provider: "claude",
    model,
    servedModels,
    effort: ai.claudeScoreEffort,
    promptVersion: SCORE_V2_PROMPT_VERSION,
    calibration: { version: "h2", center: cal.center, sd: cal.sd },
    structuralSource: source,
    structuralUsed,
    weights,
    raw: rawRounded,
    rawOverall: round2(rawOverall),
    claudeStructural,
    geometryStructural,
    gains,
    confidence: Object.fromEntries(SUB_KEYS_V2.map((k) => [k, out.subscores[k].confidence])) as SignalsV2["confidence"],
    photo: out.photo,
    notAssessed,
    captureHints: [...(out.photo.lighting !== "even" ? (["lighting"] as const) : []), ...(out.photo.retouch !== "none" ? (["retouch"] as const) : []), ...(out.photo.skinVisibility !== "clear" ? (["skin_visibility"] as const) : [])],
    viewsUsed: views,
    runs: { requested: 3, ok: run.samples.length, failed: run.reasons.length, reasons: run.reasons, attempts: run.attempts, extraRun: run.extraRun, maxSpread: round3(cons.maxSpread), spread: Object.fromEntries(SUB_KEYS_V2.map((k) => [k, round3(cons.spread[k])])) as Record<SubKey, number>, textRun: cons.nearest },
    cacheHit: false,
    progressAt: new Date(now()).toISOString(),
  });
  const numericSignals: SignalsV2 = { ...baseSignals(), explanations: {}, improveFirst: [], faceShapeDetailed: null, audit: { audited: false, rewrites: 0, fallbacks: 0, flags: [] }, observations: observationsOf(out, glassesDetected, headCoveringDetected, null) };

  await emit("overall", { overall, score_range: scoreRange, percentile, face_shape: geometry.faceShape.primary, signals: numericSignals });
  await emit("subscores", { subscores, score_range: scoreRange, gains });
  await emit("potential", { potential, score_range: scoreRange });

  // 5) Metinler: açıklamalar, yüz şekli, rapor taslağı → denetim → güvenlik → şablon.
  const explainCtx = { viewsUsed: views.length, lighting: out.photo.lighting };
  const explanations: Partial<Record<SubKey, ExplanationV2>> = {};
  for (const k of SUB_KEYS_V2) if (!excluded.has(k)) explanations[k] = buildExplanation(k, out.subscores[k], explainCtx);
  const improveFirst = improveFirstV2(out, weights, excluded, slope);
  const faceShapeRaw = reconcileFaceShape(geometry.faceShape, out.faceShapeOpinion);
  const regions = draftRegions(out);
  const seeProfessionalRaw = out.seeProfessional?.text.trim() || null;

  const texts: AuditText[] = [];
  texts.push({ path: "letter", text: truncate(out.report.letter, LIMITS.letter) || TEMPLATES.letter, fallback: TEMPLATES.letter });
  texts.push({ path: "closing", text: truncate(out.report.closing, LIMITS.closing) || TEMPLATES.closing, fallback: TEMPLATES.closing });
  for (const r of regions) {
    texts.push({ path: `regions.${r.key}.strength`, text: r.strength, fallback: TEMPLATES.regionStrength(r.key) });
    texts.push({ path: `regions.${r.key}.seen`, text: r.seen, fallback: TEMPLATES.regionSeen(r.key) });
    r.improvements.forEach((imp, i) => texts.push({ path: `regions.${r.key}.improvements[${i}]`, text: imp, fallback: STRUCTURAL_REGIONS.includes(r.key) ? TEMPLATES.regionImprovementStructural : "" }));
  }
  for (const [k, e] of Object.entries(explanations) as [SubKey, ExplanationV2][]) {
    e.lookedAt.forEach((t, i) => texts.push({ path: `explanations.${k}.lookedAt[${i}]`, text: t, fallback: i === 0 ? TEMPLATES.lookedAt(k) : "" }));
    e.held.forEach((t, i) => texts.push({ path: `explanations.${k}.held[${i}]`, text: t, fallback: i === 0 ? TEMPLATES.held(k) : "" }));
    e.lowered.forEach((t, i) => texts.push({ path: `explanations.${k}.lowered[${i}]`, text: t, fallback: "" }));
    e.raise.forEach((r, i) => r.effect && texts.push({ path: `explanations.${k}.raise[${i}].effect`, text: r.effect, fallback: "" }));
  }
  if (faceShapeRaw.detailed) texts.push({ path: "faceShape.reason", text: faceShapeRaw.detailed.reason || TEMPLATES.faceShapeReason, fallback: TEMPLATES.faceShapeReason });
  texts.push({ path: "observations.skinSurface", text: truncate(out.observations.skinSurface, LIMITS.skinSurface) || TEMPLATES.skinSurface, fallback: TEMPLATES.skinSurface });
  out.observations.other.slice(0, 3).forEach((t, i) => texts.push({ path: `observations.other[${i}]`, text: truncate(t, LIMITS.line), fallback: "" }));
  if (seeProfessionalRaw) texts.push({ path: "seeProfessional", text: truncate(seeProfessionalRaw, LIMITS.line), fallback: "", allowMaybeDiagnosis: true });

  const scoresForAudit = Object.fromEntries(SUB_KEYS_V2.filter((k) => subscores[k] !== null).map((k) => [k, subscores[k] as number]));
  const auditController = new AbortController();
  const auditTimer = setTimeout(() => auditController.abort("deadline"), opts.auditTimeoutMs ?? AUDIT_TIMEOUT_MS);
  let audited: Awaited<ReturnType<typeof auditTexts>>;
  try {
    audited = await auditTexts(texts, scoresForAudit, auditProvider, { signal: auditController.signal, timeoutMs: opts.auditTimeoutMs ?? AUDIT_TIMEOUT_MS });
  } finally {
    clearTimeout(auditTimer);
  }
  const byPath = new Map(audited.texts.map((t) => [t.path, t.text]));
  const pick = (path: string, fallback = "") => byPath.get(path) ?? fallback;

  for (const [k, e] of Object.entries(explanations) as [SubKey, ExplanationV2][]) {
    e.lookedAt = e.lookedAt.map((_, i) => pick(`explanations.${k}.lookedAt[${i}]`)).filter(Boolean);
    e.held = e.held.map((_, i) => pick(`explanations.${k}.held[${i}]`)).filter(Boolean);
    e.lowered = e.lowered.map((_, i) => pick(`explanations.${k}.lowered[${i}]`)).filter(Boolean);
    e.raise = e.raise.map((r, i) => ({ step: r.step, effect: r.effect ? pick(`explanations.${k}.raise[${i}].effect`) : "" }));
    if (!e.lookedAt.length) e.lookedAt = [TEMPLATES.lookedAt(k)];
    if (!e.held.length) e.held = [TEMPLATES.held(k)];
  }
  const faceShapeDetailed = faceShapeRaw.detailed ? { ...faceShapeRaw.detailed, reason: pick("faceShape.reason", TEMPLATES.faceShapeReason) } : null;
  const seeProfessional = seeProfessionalRaw ? pick("seeProfessional") || null : null;
  const observations = observationsOf(out, glassesDetected, headCoveringDetected, seeProfessional, pick("observations.skinSurface", TEMPLATES.skinSurface));
  observations.other = out.observations.other.slice(0, 3).map((_, i) => pick(`observations.other[${i}]`)).filter(Boolean);
  const report: ReportV3 = {
    version: "report.v3",
    letter: pick("letter", TEMPLATES.letter),
    regions: regions.map((r) => ({
      key: r.key,
      strength: pick(`regions.${r.key}.strength`, TEMPLATES.regionStrength(r.key)),
      seen: pick(`regions.${r.key}.seen`, TEMPLATES.regionSeen(r.key)),
      improvements: r.improvements.map((_, i) => pick(`regions.${r.key}.improvements[${i}]`)).filter(Boolean),
    })),
    measures: measuresFromGeometry(geometry),
    closing: closingWith(pick("closing", TEMPLATES.closing), seeProfessional),
  };

  const totalUsageByModel = new Map(run.usageByModel);
  for (const m of audited.summary.usageByModel) totalUsageByModel.set(m.model, addTokenUsage(totalUsageByModel.get(m.model) ?? ZERO_USAGE, m.usage));
  const aiUsage = summarizeUsage(run.samples.length, run.attempts + (audited.summary.model ? 1 : 0), totalUsageByModel);
  const signals: SignalsV2 = {
    ...baseSignals(),
    explanations,
    improveFirst,
    faceShapeDetailed,
    observations,
    audit: { audited: audited.summary.audited, ...(audited.summary.reason ? { reason: audited.summary.reason } : {}), rewrites: audited.summary.rewrites, fallbacks: audited.summary.fallbacks, flags: audited.summary.flags },
  };

  await emit("faceShape", { signals: { ...signals, explanations: {}, improveFirst: [] } });
  await emit("explanations", { signals: { ...signals, improveFirst: [] } });
  await emit("improveFirst", { signals, observations });
  await emit("report", { report });

  return {
    overall,
    potential,
    subscores,
    scoreRange,
    percentile,
    faceShape: geometry.faceShape.primary,
    gains,
    observations,
    signals,
    runs: vectors.map((v) => SUB_KEYS_V2.map((k) => v[k])),
    report,
    model,
    promptVersion: SCORE_V2_PROMPT_VERSION,
    calibrationVersion: ENGINE_H2.calibrationVersion,
    engineVersion: ENGINE_H2.version,
    aiUsage,
  };
}

function observationsOf(out: ScoreOutputV2, glassesDetected: boolean, headCoveringDetected: boolean, seeProfessional: string | null, skinSurface?: string): ObservationsV2 {
  return {
    facialHair: out.observations.facialHair,
    oilyHair: out.observations.oilyHair,
    photoCare: out.observations.photoCare,
    skinSurface: skinSurface ?? (truncate(out.observations.skinSurface, LIMITS.skinSurface) || TEMPLATES.skinSurface),
    other: out.observations.other.map((s) => truncate(s, LIMITS.line)).filter(Boolean).slice(0, 3),
    glassesDetected,
    headCoveringDetected,
    hairLossSignal: out.hairLossSignal,
    seeProfessional,
  };
}

export { REGION_NAMES_TR };
