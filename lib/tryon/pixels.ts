// SPEC 10.4 adım 3–5 piksel çekirdeği: saf, canvas/DOM bağımsız (web worker ve mobil Skia ortak). Birim testli.
import { edgeBand } from "./mask";

export const TRYON_PIXEL_LIMITS = {
  /** Kenar bandında parlaklık farkı eşiği (SPEC 10.4 adım 5). */
  edgeLumaDiff: 18,
} as const;

function luma(d: ArrayLike<number>, i: number) {
  return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
}

/** Maskenin tepe değeri (255, features_only'de 204). */
export function maskPeak(mask: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > peak) peak = mask[i];
  return peak || 255;
}

export type CompositePixelsResult = { out: Uint8ClampedArray; edgeLumaDiff: number; toneAdjusted: boolean };

/**
 * gp: hizalanmış G' RGBA, cp: C RGBA (aynı W×H), mask: 0–255 (255 = C'den birebir).
 * Kenar bandında parlaklık farkı > eşik ise G' maske dışında ton düzeltmesi yapılır (gp yerinde değişir).
 * Çıktı = G' × (1 − M) + C × M; maskede 255 olan pikseller C'den birebir (piksel farkı 0).
 */
export function compositePixels(gp: Uint8ClampedArray, cp: Uint8ClampedArray, mask: Uint8ClampedArray, W: number, H: number): CompositePixelsResult {
  // features_only (glow_up) maskesi en çok 204 (0,8 opaklık): bant tepe değere göre alınır, özellik içi "kenar" sayılmaz.
  const peak = maskPeak(mask);
  const band = edgeBand(mask, peak);
  let sumG = 0, sumC = 0;
  for (const i of band) {
    sumG += luma(gp, i * 4);
    sumC += luma(cp, i * 4);
  }
  const edgeLumaDiff = band.length ? Math.abs(sumG - sumC) / band.length : 0;
  let toneAdjusted = false;
  if (edgeLumaDiff > TRYON_PIXEL_LIMITS.edgeLumaDiff && band.length) {
    const gain = Math.min(1.25, Math.max(0.8, sumC / Math.max(1, sumG)));
    for (let i = 0; i < gp.length; i += 4) {
      if (mask[i >> 2] >= peak) continue;
      gp[i] = Math.min(255, gp[i] * gain);
      gp[i + 1] = Math.min(255, gp[i + 1] * gain);
      gp[i + 2] = Math.min(255, gp[i + 2] * gain);
    }
    toneAdjusted = true;
  }
  const out = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const m = mask[p] / 255;
    const i = p * 4;
    if (m === 1) {
      out[i] = cp[i]; out[i + 1] = cp[i + 1]; out[i + 2] = cp[i + 2];
    } else if (m === 0) {
      out[i] = gp[i]; out[i + 1] = gp[i + 1]; out[i + 2] = gp[i + 2];
    } else {
      out[i] = gp[i] * (1 - m) + cp[i] * m;
      out[i + 1] = gp[i + 1] * (1 - m) + cp[i + 1] * m;
      out[i + 2] = gp[i + 2] * (1 - m) + cp[i + 2] * m;
    }
    out[i + 3] = 255;
  }
  return { out, edgeLumaDiff, toneAdjusted };
}
