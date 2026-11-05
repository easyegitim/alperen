import "server-only";

import { BANDS, MISSING_PEN, POSE_GATES, STRUCT, type Band, type ComponentKey, type StructSub } from "@/lib/config/engine.server";
import type { GeometryResult } from "@/lib/face/types";
import type { ComponentSignal } from "./types";

// engine spec §3: harmony, eyes, jawline yalnız cihaz geometrisinden. Saf. Herkes için tek bant; sunum, cinsiyet
// veya köken parametresi YOKTUR (imzada da). Yalnız ceza: bant içi yüz ödüllendirilmez, ölçülemeyen bileşen 0 maliyet.

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Sıfır-ceza bölgesi [c − h, c + h]; dışında r boyunca 0 → 1. */
export function twoSided(v: number, c: number, h: number, r: number): number {
  return clamp01((Math.abs(v - c) - h) / r);
}

/** Yalnız fazla asimetri ceza alır. */
export function oneSided(v: number, h: number, r: number): number {
  return clamp01((v - h) / r);
}

/** ramp(v, full, zero): v ≤ full → 1, v ≥ zero → 0, arada doğrusal. */
export function ramp(v: number, full: number, zero: number): number {
  return clamp01((zero - v) / (zero - full));
}

export function bandPenalty(v: number, band: Band): number {
  return band.kind === "twoSided" ? twoSided(v, band.c, band.h, band.r) : oneSided(v, band.h, band.r);
}

export type StructuralResult = {
  /** Yuvarlanmamış alt skorlar ∈ [5,5 − amp, 5,5]. */
  subs: Record<StructSub, number>;
  components: ComponentSignal[];
  /** Son karenin yaw/pitch'i ölçülmüş bir tüm-kare bileşeninin kapısını 1'in altına indirdi mi (çekim ipucu "pose"). */
  poseLimited: boolean;
};

function metricOf(g: GeometryResult, k: ComponentKey): number | null {
  const m = g.metrics;
  const v = (() => {
    switch (k) {
      case "symFace":
        return m.symmetry?.face;
      case "symEyes":
        return m.symmetry?.eyes;
      case "symLower":
        return m.symmetry?.lower;
      case "vertical":
        return m.lowerToMiddle;
      case "eyeMouth":
        return m.eyeMouthRatio;
      case "spacing":
        return m.ipdRatio;
      case "tilt":
        return m.canthalTiltDeg;
      case "jawWidth":
        return m.jawRatio;
    }
  })();
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Yapısal skor. ctx.beardOverJaw: oylanan sakal kısa/tam ise jawWidth ve symLower ölçülmedi sayılır (MediaPipe
 * konturu sakalı izler) ve maliyetsizdir. lengthRatio, fwhr, foreheadRatio, thirds.upper, brightness ve relaxed hiçbir
 * bileşene girmez.
 */
export function scoreStructural(g: GeometryResult, ctx: { beardOverJaw: boolean }): StructuralResult {
  const yaw = Math.abs(g.quality.yaw);
  const pitch = Math.abs(g.quality.pitch);
  const sums: Record<StructSub, number> = { harmony: 0, eyes: 0, jawline: 0 };
  const components: ComponentSignal[] = [];
  let poseLimited = false;

  for (const key of Object.keys(BANDS) as ComponentKey[]) {
    const { sub, w, band, gate: gateKind } = BANDS[key];
    const v = metricOf(g, key);
    const beardSkip = ctx.beardOverJaw && (key === "jawWidth" || key === "symLower");
    let gate = 0;
    let pen = MISSING_PEN;
    if (v !== null && !beardSkip) {
      gate =
        gateKind === "pitch"
          ? ramp(pitch, POSE_GATES.full, POSE_GATES.zero)
          : gateKind === "yaw"
            ? ramp(yaw, POSE_GATES.full, POSE_GATES.zero)
            : 1;
      pen = bandPenalty(v, band);
      if ((gateKind === "pitch" || gateKind === "yaw") && gate < 1) poseLimited = true;
    }
    const status = v === null || beardSkip || gate === 0 ? "not_measured" : "measured";
    sums[sub] += w * gate * pen;
    components.push({ key, sub, pen: round4(pen), gate: round4(gate), status });
  }

  const subs = {
    harmony: STRUCT.reference - STRUCT.amp * sums.harmony,
    eyes: STRUCT.reference - STRUCT.amp * sums.eyes,
    jawline: STRUCT.reference - STRUCT.amp * sums.jawline,
  };
  return { subs, components, poseLimited };
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
