// hybrid.v1 motor testleri için sentetik girdiler ve sahte gözlem sağlayıcısı (ağ yok, ücretli çağrı yok).
import type { Observation } from "@/lib/ai/observationSchema";
import { abortReason } from "@/lib/ai/anthropic";
import { SampleError, type ObservationProvider, type ObservationSample } from "@/lib/ai/observeProvider";
import type { TokenUsage } from "@/lib/config/ai.server";
import type { GeometryResult } from "@/lib/face/types";
import type { HybridContext } from "@/lib/score/engine/types";

/** Referans profil: her öğe tipik kategoride. */
export const REF_OBS: Observation = {
  photo: { faceCount: "one", lighting: "even", skinVisibility: "clear", retouch: "none" },
  skin: {
    blemishes: "few",
    blemishZone: "cheeks",
    texture: "slightly_uneven",
    evenness: "mostly_even",
    shine: "some",
    shineZone: "t_zone",
    visibleSkinConcern: false,
    concernZone: "none",
  },
  hair: { visibility: "visible", neatness: "slightly_untidy", shape: "softening" },
  grooming: { brows: "few_strays", lips: "slightly_dry", facialHair: "none_visible", facialHairEdges: "not_applicable" },
};

export const BEST_OBS: Observation = {
  ...REF_OBS,
  skin: { ...REF_OBS.skin, blemishes: "none", blemishZone: "none", texture: "smooth", evenness: "even", shine: "balanced", shineZone: "none" },
  hair: { visibility: "visible", neatness: "neat", shape: "defined" },
  grooming: { brows: "tidy", lips: "smooth", facialHair: "none_visible", facialHairEdges: "not_applicable" },
};

export const UNTENDED_OBS: Observation = {
  ...REF_OBS,
  skin: { ...REF_OBS.skin, blemishes: "many", blemishZone: "widespread", texture: "uneven", evenness: "uneven", shine: "very", shineZone: "widespread" },
  hair: { visibility: "visible", neatness: "untidy", shape: "grown_out" },
  grooming: { brows: "unruly", lips: "dry_cracked", facialHair: "stubble", facialHairEdges: "untidy" },
};

/** Kısmi derin birleştirme (grup bazında). */
export function obs(patch: { [G in keyof Observation]?: Partial<Observation[G]> } = {}, base: Observation = REF_OBS): Observation {
  return {
    photo: { ...base.photo, ...patch.photo },
    skin: { ...base.skin, ...patch.skin },
    hair: { ...base.hair, ...patch.hair },
    grooming: { ...base.grooming, ...patch.grooming },
  };
}

export const CTX: HybridContext = { headCovering: false, presentation: "male", beardPreference: "any" };

/** Her yapısal oran bandın içinde, iyi poz. */
export const GEO: GeometryResult = {
  version: "geo-v1",
  quality: { yaw: 0, pitch: 0, roll: 0, brightness: 130, sharpness: 90, passed: true },
  metrics: {
    lengthRatio: 1.3,
    jawRatio: 0.85,
    foreheadRatio: 0.9,
    fwhr: 1.9,
    canthalTiltDeg: 5,
    lowerToMiddle: 1.1,
    thirds: { upper: null, middle: 0.45, lower: 0.55 },
    hairlineFound: false,
    ipdRatio: 0.47,
    eyeMouthRatio: 0.39,
    symmetry: { face: 0.01, eyes: 0.01, lower: 0.01 },
  },
  faceShape: { primary: "oval", confidence: 0.7 },
  capturedAt: "2026-10-30T10:00:00.000Z",
};

export function geo(patch: { quality?: Partial<GeometryResult["quality"]>; metrics?: Partial<GeometryResult["metrics"]> } = {}): GeometryResult {
  return { ...GEO, quality: { ...GEO.quality, ...patch.quality }, metrics: { ...GEO.metrics, ...patch.metrics } };
}

export const USAGE: TokenUsage = { input: 1500, output: 300, cacheRead: 1200, cacheWrite5m: 0, cacheWrite1h: 0 };

type Step = (signal: AbortSignal, call: number) => Promise<ObservationSample>;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new SampleError(abortReason(signal)));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new SampleError(abortReason(signal)));
      },
      { once: true },
    );
  });
}

export const ok =
  (o: Observation, ms = 10, extra: Partial<ObservationSample> = {}): Step =>
  async (signal) => {
    await delay(ms, signal);
    return { obs: o, model: "claude-opus-5-5", fallbackServed: false, usage: USAGE, ...extra };
  };

export const fail =
  (reason: ConstructorParameters<typeof SampleError>[0], ms = 10, extra: ConstructorParameters<typeof SampleError>[1] = {}): Step =>
  async (signal) => {
    await delay(ms, signal);
    throw new SampleError(reason, extra);
  };

/** Sıradaki çağrıya sıradaki adımı verir; adım bitince son adım tekrarlanır. Sinyalleri ve zaman aşımlarını kaydeder. */
export class FakeProvider implements ObservationProvider {
  readonly name = "claude" as const;
  readonly model = "claude-opus-5-5";
  readonly signals: AbortSignal[] = [];
  readonly timeouts: number[] = [];
  calls = 0;
  constructor(private readonly steps: Step[]) {}
  observeOnce(_image: string, signal: AbortSignal, timeoutMs: number): Promise<ObservationSample> {
    const i = this.calls++;
    this.signals.push(signal);
    this.timeouts.push(timeoutMs);
    const step = this.steps[Math.min(i, this.steps.length - 1)];
    return step(signal, i);
  }
}

/** Kısa sahte base64 (gerçek görsel değil). */
export const IMG = "AAAA";
