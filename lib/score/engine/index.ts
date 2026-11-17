import "server-only";

import { DEADLINE_ABORT_REASON, abortReason, type SampleReason } from "@/lib/ai/anthropic";
import type { Observation } from "@/lib/ai/observationSchema";
import { SampleError, getObservationProvider, type ObservationProvider, type ObservationSample } from "@/lib/ai/observeProvider";
import { ApiError } from "@/lib/api/errors";
import { ZERO_USAGE, assertEngineReady, estUsd, getAiEnv, type ModelUsage, type TokenUsage } from "@/lib/config/ai.server";
import { ENGINE, ENGINE_NORMS_ID, ENGINE_STATUS, MOD_GAIN, OBSERVE, POTENTIAL_H1 } from "@/lib/config/engine.server";
import { SUB_KEYS, type SubKeyV1 } from "@/lib/config/teaser";
import type { GeometryResult } from "@/lib/face/types";
import { calibrate } from "@/lib/score/calibration";
import { computePotential } from "@/lib/score/potential";
import { aggregateObservations, samplesIdentical } from "./aggregate";
import { scoreModifiable } from "./categories";
import { scoreStructural } from "./geometry";
import { deriveGains, improveFirst } from "./potential";
import { captureHints, composeExplain, composeObservations, leverLabel, skinConcernNote } from "./text";
import type { AiUsage, HybridContext, HybridScored, SignalsV1 } from "./types";

// engine spec §2.5: N paralel gözlem → yeter sayı / erken durma / son tarih → oylama → koddaki skor. Görsel yalnız bu
// çağrı süresince bellekte; görsel, istem, oylar ve çıktı loglanmaz (yalnız neden, durum ve sayılar).

export type { AiUsage, HybridContext, HybridScored, SignalsV1 } from "./types";

export type ScoreHybridOptions = {
  /** Paralel örnek sayısı (1–5); verilmezse OBSERVE_CALLS. */
  calls?: number;
  now?: () => number;
  /** Başarıda ve hatada bir kez çağrılır (rota ai_usage'ı her iki durumda da yazar). */
  onUsage?: (u: AiUsage) => void;
};

type AttemptOutcome = { ok: true; sample: ObservationSample } | { ok: false; error: SampleError };

/** Sinyal iptal edilince sağlayıcı yanıt vermese bile denemeyi bitirir. */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new SampleError(abortReason(signal)));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SampleError(abortReason(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function toSampleError(e: unknown, signal: AbortSignal): SampleError {
  if (e instanceof SampleError) return e;
  if (signal.aborted) return new SampleError(abortReason(signal));
  // Sağlayıcı sözleşmesi dışında bir hata: kodlama hatası; yeniden denenmez.
  return new SampleError("schema", { detail: "unexpected" });
}

function addUsage(acc: TokenUsage, u: TokenUsage | undefined): TokenUsage {
  if (!u) return acc;
  return {
    input: acc.input + u.input,
    output: acc.output + u.output,
    cacheRead: acc.cacheRead + u.cacheRead,
    cacheWrite5m: acc.cacheWrite5m + u.cacheWrite5m,
    cacheWrite1h: acc.cacheWrite1h + u.cacheWrite1h,
  };
}

/**
 * Gözlem örneklerini toplar. Hata fırlatırsa rota satırı failed yapar (hak iade); onUsage yine çağrılır.
 * Yalnız geometriyle sonuç asla döndürülmez: altı alt skorun üçü, genel skor ve potansiyel oylara bağlıdır.
 */
async function collectSamples(
  imageBase64: string,
  provider: ObservationProvider,
  calls: number,
  now: () => number,
): Promise<{
  obs: Observation[];
  samples: ObservationSample[];
  reasons: SampleReason[];
  slotReasons: SampleReason[];
  attempts: number;
  earlyStop: boolean;
  usageByModel: Map<string, TokenUsage>;
  fatal: SampleError | null;
}> {
  const start = now();
  const remaining = () => OBSERVE.deadlineMs - (now() - start);
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(DEADLINE_ABORT_REASON), OBSERVE.deadlineMs);

  const children = new Set<AbortController>();
  const samples: ObservationSample[] = [];
  const reasons: SampleReason[] = [];
  const slotReasons: SampleReason[] = [];
  const usageByModel = new Map<string, TokenUsage>();
  let attempts = 0;
  let earlyStop = false;
  let fatal: SampleError | null = null;
  let stopped = false;

  const billOne = (model: string, u: TokenUsage) => usageByModel.set(model, addUsage(usageByModel.get(model) ?? ZERO_USAGE, u));
  /** Model kırılımı varsa (sunucu taraflı yedekte reddeden deneme dahil) her halka kendi modeline; yoksa toplam `model`e. */
  const bill = (model: string, u: TokenUsage | undefined, byModel?: readonly ModelUsage[]) => {
    if (byModel && byModel.length > 0) byModel.forEach((m) => billOne(m.model, m.usage));
    else if (u) billOne(model, u);
  };
  const stopAll = (reason: string) => {
    stopped = true;
    for (const c of children) c.abort(reason);
  };

  async function attempt(): Promise<AttemptOutcome> {
    attempts++;
    const child = new AbortController();
    children.add(child);
    const onDeadline = () => child.abort(DEADLINE_ABORT_REASON);
    if (deadline.signal.aborted) onDeadline();
    else deadline.signal.addEventListener("abort", onDeadline, { once: true });
    const timeoutMs = Math.max(1, Math.min(OBSERVE.attemptTimeoutMs, remaining()));
    try {
      const sample = await raceAbort(provider.observeOnce(imageBase64, child.signal, timeoutMs), child.signal);
      return { ok: true, sample };
    } catch (e) {
      return { ok: false, error: toSampleError(e, child.signal) };
    } finally {
      deadline.signal.removeEventListener("abort", onDeadline);
      children.delete(child);
    }
  }

  async function slot(): Promise<void> {
    let retried = false;
    for (;;) {
      if (stopped) return;
      const r = await attempt();
      if (r.ok) {
        bill(r.sample.model, r.sample.usage, r.sample.usageByModel);
        if (stopped && !earlyStop) return;
        const twin = samples.some((s) => samplesIdentical(s.obs, r.sample.obs));
        samples.push(r.sample);
        if (twin && !earlyStop) {
          earlyStop = true;
          stopAll("early_stop");
        }
        return;
      }
      const err = r.error;
      bill(err.model ?? provider.model, err.usage, err.usageByModel);
      reasons.push(err.reason);
      if (err.reason === "fatal" || err.reason === "too_large") {
        if (!fatal) fatal = err;
        stopAll(`${err.reason}_sibling`);
        slotReasons.push(err.reason);
        return;
      }
      const retryable = err.reason === "transient" || err.reason === "timeout";
      if (retryable && !retried && !stopped && remaining() >= OBSERVE.retryMinRemainingMs && attempts < OBSERVE.maxAttempts) {
        retried = true;
        continue;
      }
      slotReasons.push(err.reason);
      return;
    }
  }

  try {
    await Promise.all(Array.from({ length: calls }, () => slot()));
  } finally {
    clearTimeout(timer);
  }
  return { obs: samples.map((s) => s.obs), samples, reasons, slotReasons, attempts, earlyStop, usageByModel, fatal };
}

export async function scoreHybrid(
  imageBase64: string,
  geometry: GeometryResult,
  ctx: HybridContext,
  provider: ObservationProvider = getObservationProvider(),
  opts: ScoreHybridOptions = {},
): Promise<HybridScored> {
  assertEngineReady(process.env, { status: ENGINE_STATUS, path: "score" });
  const env = getAiEnv();
  const calls = Math.min(5, Math.max(1, Math.round(opts.calls ?? env.observeCalls)));
  const quorum = calls === 1 ? 1 : OBSERVE.quorum;
  const now = opts.now ?? Date.now;

  let usage: AiUsage = { calls, attempts: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, estUsd: 0, servedModels: [] };
  try {
    const run = await collectSamples(imageBase64, provider, calls, now);
    usage = summarizeUsage(calls, run.attempts, run.usageByModel);

    if (run.fatal) {
      console.warn(`[engine] ${run.fatal.reason === "too_large" ? "pipeline_bug too_large" : "config_error"} status=${run.fatal.status ?? "-"}`);
      throw run.fatal.reason === "too_large" ? new ApiError("IMAGE_TOO_LARGE", "observe_too_large") : new ApiError("AI_FAILED", "observe_config_error");
    }
    if (run.samples.length < quorum) {
      const refusals = run.reasons.filter((r) => r === "refusal").length;
      console.warn(`[engine] quorum_lost ok=${run.samples.length} reasons=${run.slotReasons.join(",")}`);
      if (refusals >= Math.min(2, calls)) throw new ApiError("AI_SAFETY_BLOCKED", "observe_refusal");
      if (run.slotReasons.length > 0 && run.slotReasons.every((r) => r === "timeout")) throw new ApiError("AI_TIMEOUT", "observe_timeout");
      throw new ApiError("AI_FAILED", "observe_quorum");
    }
    const badFace = run.obs.filter((o) => o.photo.faceCount !== "one").length;
    if (badFace * 2 >= run.obs.length) throw new ApiError("NO_FACE", "observe_no_single_face");

    const voted = aggregateObservations(run.obs);
    if (voted.agreement < OBSERVE.lowAgreementLog) console.warn(`[engine] low_agreement ${voted.agreement}`);
    const fallbackServed = run.samples.filter((s) => s.fallbackServed).length;
    const scored = scoreFromVotes(geometry, ctx, voted.final);
    const servedModels = usage.servedModels;
    const fallbackModel = servedModels.find((m) => m !== provider.model);
    const model = fallbackServed > 0 ? `${provider.model}+fallback:${fallbackModel ?? "unknown"}` : provider.model;

    const signals: SignalsV1 = {
      engine: ENGINE.version,
      improveFirst: scored.improveFirst,
      explain: scored.explain,
      notAssessed: scored.notAssessed,
      captureHints: scored.captureHints,
      v: 1,
      provider: provider.name,
      model: provider.model,
      servedModels,
      effort: provider.name === "claude" ? env.claudeObserveEffort : "none",
      promptVersion: ENGINE.promptVersion,
      norms: ENGINE_NORMS_ID,
      modGain: MOD_GAIN,
      weights: scored.weights,
      samples: { ok: run.samples.length, failed: run.reasons.length, reasons: run.reasons, fallbackServed, earlyStop: run.earlyStop, attempts: run.attempts },
      obs: voted.final,
      agreement: voted.agreement,
      components: scored.components,
      items: scored.items,
      raw: scored.rawRounded,
      gains: scored.subGains,
    };

    return {
      subscores: scored.subscores,
      rawSubscores: scored.rawRounded,
      rawOverall: Math.round(scored.rawOverall * 100) / 100,
      overall: scored.overall,
      potential: scored.potential,
      gains: scored.gains,
      observations: scored.observations,
      flags: { visibleSkinConcern: voted.final.skin.visibleSkinConcern, skinConcernNote: skinConcernNote(voted.final), multiplePeopleOrNotAFace: false },
      samples: run.samples.length,
      model,
      promptVersion: ENGINE.promptVersion,
      calibrationVersion: ENGINE.calibrationVersion,
      engineVersion: ENGINE.version,
      signals,
      aiUsage: usage,
    };
  } finally {
    opts.onUsage?.(usage);
  }
}

function summarizeUsage(calls: number, attempts: number, byModel: Map<string, TokenUsage>): AiUsage {
  let total = ZERO_USAGE;
  let usd = 0;
  for (const [model, u] of byModel) {
    total = addUsage(total, u);
    usd += estUsd(u, model);
  }
  return {
    calls,
    attempts,
    input: total.input,
    output: total.output,
    cacheRead: total.cacheRead,
    cacheWrite: total.cacheWrite5m + total.cacheWrite1h,
    estUsd: Math.round(usd * 1e6) / 1e6,
    servedModels: [...byModel.keys()].sort(),
  };
}

/**
 * Oylanmış gözlemden tüm sayılar ve metinler (saf; ağ yok). Betikler (refit, compare-observers) saklanan oyları
 * yeni ücretli çağrı olmadan bununla yeniden puanlayabilir.
 */
export function scoreFromVotes(geometry: GeometryResult, ctx: HybridContext, final: Observation) {
  const struct = scoreStructural(geometry, { beardOverJaw: final.grooming.facialHair === "short_beard" || final.grooming.facialHair === "full_beard" });
  const mod = scoreModifiable(final, ctx);
  const raw: Record<SubKeyV1, number> = { ...struct.subs, ...mod.subs };
  const weights = mod.weights;
  const rawOverall = SUB_KEYS.reduce((s, k) => s + weights[k] * raw[k], 0);
  const overall = calibrate(rawOverall, "h1");
  const subscores = Object.fromEntries(SUB_KEYS.map((k) => [k, calibrate(raw[k], "h1")])) as Record<SubKeyV1, number>;
  const { gains, perItem, subGains } = deriveGains(final, mod, leverLabel);
  const potential = computePotential({
    rawSubscores: raw,
    gains,
    overall,
    bodyFatContextAllowed: false,
    beardOption: false,
    weights,
    caps: POTENTIAL_H1.caps,
    calibrate: (r) => calibrate(r, "h1"),
  });
  const rawRounded = Object.fromEntries(SUB_KEYS.map((k) => [k, Math.round(raw[k] * 1000) / 1000])) as Record<SubKeyV1, number>;
  return {
    subscores,
    rawRounded,
    rawOverall,
    overall,
    potential,
    gains,
    subGains: { skin: round3(subGains.skin), hair: round3(subGains.hair), grooming: round3(subGains.grooming) },
    improveFirst: improveFirst(perItem, mod, ctx),
    observations: Object.fromEntries(
      Object.entries(composeObservations(final, mod, ctx)).filter((e): e is [string, string] => typeof e[1] === "string"),
    ),
    explain: composeExplain(mod, struct),
    notAssessed: mod.notAssessed,
    captureHints: captureHints(final, mod, struct),
    weights,
    components: struct.components,
    items: mod.items,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
