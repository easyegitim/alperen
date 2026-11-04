import "server-only";

import { DEADLINE_ABORT_REASON, abortReason, type SampleReason } from "@/lib/ai/anthropic";
import { SampleError } from "@/lib/ai/observeProvider";
import type { LabeledImage, ScoreSampleV2, ScoringProviderV2 } from "@/lib/ai/provider";
import { ZERO_USAGE, addTokenUsage, type ModelUsage, type TokenUsage } from "@/lib/config/ai.server";
import { CONSENSUS } from "@/lib/config/engine.h2.server";
import { SUB_KEYS_V2, type SubKey } from "@/lib/config/teaser";

// Ortanca-3 tutarlılığı (KB §4.1–4.2; CONTRACTS_V2 §4 CONSENSUS): üç paralel çalıştırma → alt skor bazında ortanca;
// herhangi bir alt skorda yayılım (en büyük − en küçük) > 0,5 ise dördüncü çalıştırma ve dördün ortancası; rapor
// metni ortancaya en yakın çalıştırmadan. Saf kısım (medianOf, consensus) ve orkestrasyon (collectRuns) ayrı.
// Görsel yalnız çağrı süresince bellekte; görsel, istem, çıktı loglanmaz (yalnız neden ve sayılar).

export type RunVector = Record<SubKey, number>;

export function medianOf(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function perSubMedian(runs: readonly RunVector[]): RunVector {
  return Object.fromEntries(SUB_KEYS_V2.map((k) => [k, medianOf(runs.map((r) => r[k]))])) as RunVector;
}

export function perSubSpread(runs: readonly RunVector[]): RunVector {
  return Object.fromEntries(
    SUB_KEYS_V2.map((k) => {
      const v = runs.map((r) => r[k]);
      return [k, v.length ? Math.max(...v) - Math.min(...v) : 0];
    }),
  ) as RunVector;
}

/** Herhangi bir alt skorda yayılım eşiği aşıldı mı (ek çalıştırma tetiği)? */
export function needsExtraRun(runs: readonly RunVector[], threshold: number = CONSENSUS.extraRunIfSpread): boolean {
  if (runs.length < 2) return false;
  return Object.values(perSubSpread(runs)).some((s) => s > threshold + 1e-9);
}

/** Ortancaya en yakın çalıştırma (Σ|fark| en küçük; eşitlikte ilk). Rapor metni buradan alınır. */
export function nearestRunIndex(runs: readonly RunVector[], median: RunVector): number {
  let best = 0;
  let bestD = Infinity;
  runs.forEach((r, i) => {
    const d = SUB_KEYS_V2.reduce((s, k) => s + Math.abs(r[k] - median[k]), 0);
    if (d < bestD - 1e-12) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export type Consensus = { median: RunVector; spread: RunVector; maxSpread: number; nearest: number };

export function consensus(runs: readonly RunVector[]): Consensus {
  if (runs.length === 0) throw new Error("consensus_no_runs");
  const median = perSubMedian(runs);
  const spread = perSubSpread(runs);
  return { median, spread, maxSpread: Math.max(...Object.values(spread)), nearest: nearestRunIndex(runs, median) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Orkestrasyon

/**
 * Süre bütçesi (Ç16 "sınır yok" ile platform sınırı arasında): rota maxDuration 300 s; puanlama en çok ~230 s,
 * denetim ve DB kalanla. Ek (4.) çalıştırma yalnız yeterli süre kalmışsa yapılır; yapılamazsa signals'a yazılır.
 */
export const SCORE_V2_RUNTIME = { deadlineMs: 230_000, attemptTimeoutMs: 120_000, retryMinRemainingMs: 60_000, extraRunMinRemainingMs: 75_000, maxAttempts: 6 } as const;

export type CollectedRuns = {
  samples: ScoreSampleV2[];
  reasons: SampleReason[];
  attempts: number;
  extraRun: "none" | "done" | "skipped_time" | "skipped_max";
  usageByModel: Map<string, TokenUsage>;
  fatal: SampleError | null;
};

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

const toSampleError = (e: unknown, signal: AbortSignal): SampleError =>
  e instanceof SampleError ? e : signal.aborted ? new SampleError(abortReason(signal)) : new SampleError("schema", { detail: "unexpected" });

export function vectorOf(sample: ScoreSampleV2): RunVector {
  return Object.fromEntries(SUB_KEYS_V2.map((k) => [k, sample.out.subscores[k].score])) as RunVector;
}

/**
 * runs paralel çalıştırma; geçici hata/zaman aşımında slot bir kez yeniden dener; fatal/too_large kardeşleri iptal eder.
 * En az 2 başarılı çalıştırma varsa ve yayılım eşiği aşılırsa (maxRuns'a kadar) bir ek çalıştırma yapılır.
 */
export async function collectRuns(
  provider: ScoringProviderV2,
  images: readonly LabeledImage[],
  userText: string,
  opts: { runs?: number; now?: () => number; cfg?: typeof CONSENSUS; runtime?: typeof SCORE_V2_RUNTIME } = {},
): Promise<CollectedRuns> {
  const cfg = opts.cfg ?? CONSENSUS;
  const rt = opts.runtime ?? SCORE_V2_RUNTIME;
  const now = opts.now ?? Date.now;
  const start = now();
  const remaining = () => rt.deadlineMs - (now() - start);
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(DEADLINE_ABORT_REASON), rt.deadlineMs);
  const children = new Set<AbortController>();
  const samples: ScoreSampleV2[] = [];
  const reasons: SampleReason[] = [];
  const usageByModel = new Map<string, TokenUsage>();
  let attempts = 0;
  let fatal: SampleError | null = null;
  let stopped = false;

  const billOne = (model: string, u: TokenUsage) => usageByModel.set(model, addTokenUsage(usageByModel.get(model) ?? ZERO_USAGE, u));
  const bill = (model: string, u: TokenUsage | undefined, byModel?: readonly ModelUsage[]) => {
    if (byModel && byModel.length > 0) byModel.forEach((m) => billOne(m.model, m.usage));
    else if (u) billOne(model, u);
  };
  const stopAll = (reason: string) => {
    stopped = true;
    for (const c of children) c.abort(reason);
  };

  async function attempt(): Promise<{ ok: true; sample: ScoreSampleV2 } | { ok: false; error: SampleError }> {
    attempts++;
    const child = new AbortController();
    children.add(child);
    const onDeadline = () => child.abort(DEADLINE_ABORT_REASON);
    if (deadline.signal.aborted) onDeadline();
    else deadline.signal.addEventListener("abort", onDeadline, { once: true });
    const timeoutMs = Math.max(1, Math.min(rt.attemptTimeoutMs, remaining()));
    try {
      const sample = await raceAbort(provider.scoreOnce(images, userText, child.signal, timeoutMs), child.signal);
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
        samples.push(r.sample);
        return;
      }
      const err = r.error;
      bill(err.model ?? provider.model, err.usage, err.usageByModel);
      reasons.push(err.reason);
      if (err.reason === "fatal" || err.reason === "too_large") {
        if (!fatal) fatal = err;
        stopAll(`${err.reason}_sibling`);
        return;
      }
      const retryable = err.reason === "transient" || err.reason === "timeout" || err.reason === "schema" || err.reason === "max_tokens";
      if (retryable && !retried && !stopped && remaining() >= rt.retryMinRemainingMs && attempts < rt.maxAttempts) {
        retried = true;
        continue;
      }
      return;
    }
  }

  let extraRun: CollectedRuns["extraRun"] = "none";
  try {
    await Promise.all(Array.from({ length: opts.runs ?? cfg.runs }, () => slot()));
    // Yayılım yalnız tek yüz gören çalıştırmalar üzerinden (scoreV2 de yalnız onları ortancaya alır).
    const usable = samples.filter((s) => s.out.photo.faceCount === "one");
    if (!fatal && usable.length >= 2 && needsExtraRun(usable.map(vectorOf), cfg.extraRunIfSpread)) {
      if (samples.length >= cfg.maxRuns) extraRun = "skipped_max";
      else if (remaining() < rt.extraRunMinRemainingMs || attempts >= rt.maxAttempts) extraRun = "skipped_time";
      else {
        await slot();
        extraRun = "done";
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { samples, reasons, attempts, extraRun, usageByModel, fatal };
}
