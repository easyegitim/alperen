// "İyileşmiş halin" (glow_up) piksel kapıları (PLAN_V2 5d; KB §7.2, Ç9; CONTRACTS_V2 S2.6 GLOW_UP_GATE).
// Saf, canvas/DOM bağımsız (web worker ve mobil ortak). Cilt bölgesi lib/tryon/mask.ts skinRegionMask ile gelir.
// - textureRatio: çıktı yüksek frekans enerjisi / orijinal; eşik altı "aşırı pürüzsüz" (skin_over_smoothed), üstü bozukluk.
// - toneShift: cilt bölgesinde ortalama L* farkı (ten rengi korunur).
// - rewriteHighFrequency: orijinalin ince dokusu (ben, çil, iz, gözenek) karışım gücüyle geri yazılır; modelin düşük
//   frekanslı ton değişimi (ton eşitliği, kızarıklık) kalır.
import { GLOW_UP_GATE } from "@/lib/config/tryon";

/** Doku ölçümü ve geri yazım için kutu bulanıklığı yarıçapı (piksel). */
export const HF_RADIUS_PX = 2;

export type GlowUpGateReason = "skin_over_smoothed" | "skin_texture_artifact" | "skin_tone_shift";
export type GlowUpGateResult = { textureRatio: number; toneShift: number; ok: boolean; reason: GlowUpGateReason | null; pixels: number };
export type GlowUpThresholds = { minTextureRatio: number; maxTextureRatio: number; maxSkinToneShift: number };

export function lumaPlane(rgba: ArrayLike<number>, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    out[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return out;
}

/** Ayrılabilir tek geçiş kutu bulanıklığı (kenarda kenetlenir). */
export function boxBlurPlane(src: Float32Array, W: number, H: number, r = HF_RADIUS_PX): Float32Array {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const n = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[row + clamp(x + k, 0, W - 1)];
      tmp[row + x] = acc / n;
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[clamp(y + k, 0, H - 1) * W + x];
      out[y * W + x] = acc / n;
    }
  }
  return out;
}

/** Bölgedeki ortalama yüksek frekans enerjisi: mean |p − blur(p)|. Bölge boşsa 0. */
export function textureEnergy(plane: Float32Array, W: number, H: number, region: ArrayLike<number>, r = HF_RADIUS_PX): number {
  const blur = boxBlurPlane(plane, W, H, r);
  let sum = 0, n = 0;
  for (let p = 0; p < W * H; p++) {
    if (!region[p]) continue;
    sum += Math.abs(plane[p] - blur[p]);
    n++;
  }
  return n ? sum / n : 0;
}

/** sRGB parlaklığından yaklaşık CIE L* (0–100). */
export function lumaToLStar(luma: number): number {
  const y = Math.min(1, Math.max(0, luma / 255));
  const f = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
  return Math.max(0, 116 * f - 16);
}

/** Bölgede ortalama L* kayması (çıktı − orijinal, işaretli). */
export function skinToneShift(origLuma: Float32Array, outLuma: Float32Array, region: ArrayLike<number>): number {
  let sum = 0, n = 0;
  for (let p = 0; p < origLuma.length; p++) {
    if (!region[p]) continue;
    sum += lumaToLStar(outLuma[p]) - lumaToLStar(origLuma[p]);
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * Kapı: modelin çıktısı (geri yazımdan ÖNCE) ölçülür. ok=false → görsel gösterilmez, hak düşmez (Ç10).
 * Eşikler GLOW_UP_GATE (ÖNERİ, placeholder; ilk kapı koşusunda ölçülür).
 */
export function glowUpGate(origRgba: ArrayLike<number>, outRgba: ArrayLike<number>, region: ArrayLike<number>, W: number, H: number, t: GlowUpThresholds = GLOW_UP_GATE): GlowUpGateResult {
  const o = lumaPlane(origRgba, W, H), g = lumaPlane(outRgba, W, H);
  let pixels = 0;
  for (let p = 0; p < W * H; p++) if (region[p]) pixels++;
  const eo = textureEnergy(o, W, H, region), eg = textureEnergy(g, W, H, region);
  const textureRatio = eo > 0 ? eg / eo : 1;
  const toneShift = skinToneShift(o, g, region);
  let reason: GlowUpGateReason | null = null;
  if (pixels === 0) reason = null;
  else if (textureRatio < t.minTextureRatio) reason = "skin_over_smoothed";
  else if (textureRatio > t.maxTextureRatio) reason = "skin_texture_artifact";
  else if (Math.abs(toneShift) > t.maxSkinToneShift) reason = "skin_tone_shift";
  return { textureRatio, toneShift, ok: reason === null, reason, pixels };
}

/**
 * Yüksek frekans geri yazımı (yerinde, out üzerinde): bölgede out' = blur(out) + (1−s)·HF(out) + s·HF(orig).
 * s = strength (GLOW_UP_GATE.hfRewriteStrength 0,5). Kanal bazında; alfa dokunulmaz. Bölge dışı piksel değişmez.
 */
export function rewriteHighFrequency(out: Uint8ClampedArray, orig: ArrayLike<number>, region: ArrayLike<number>, W: number, H: number, strength: number = GLOW_UP_GATE.hfRewriteStrength, r = HF_RADIUS_PX): Uint8ClampedArray {
  const s = Math.min(1, Math.max(0, strength));
  if (s === 0) return out;
  for (let c = 0; c < 3; c++) {
    const po = new Float32Array(W * H), pg = new Float32Array(W * H);
    for (let p = 0; p < W * H; p++) {
      po[p] = orig[p * 4 + c];
      pg[p] = out[p * 4 + c];
    }
    const bo = boxBlurPlane(po, W, H, r), bg = boxBlurPlane(pg, W, H, r);
    for (let p = 0; p < W * H; p++) {
      if (!region[p]) continue;
      const v = bg[p] + (1 - s) * (pg[p] - bg[p]) + s * (po[p] - bo[p]);
      out[p * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
