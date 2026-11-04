import { describe, expect, it } from "vitest";
import { GLOW_UP_GATE } from "@/lib/config/tryon";
import { boxBlurPlane, glowUpGate, lumaPlane, lumaToLStar, rewriteHighFrequency, skinToneShift, textureEnergy } from "@/lib/tryon/glowUp";

const W = 64, H = 64;
/** Deterministik "doku": satır/sütun bazlı yüksek frekanslı desen + ben benzeri koyu noktalar. */
function textured(base: number, amp: number, seed = 1): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = ((x * 7 + y * 13 + seed) % 5) - 2; // −2..2
      let v = base + n * amp;
      if ((x % 17 === 3 && y % 19 === 5)) v -= 60; // ben/çil
      v = Math.max(0, Math.min(255, v));
      out.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return out;
}
const flat = (v: number) => {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) out.set([v, v, v, 255], p * 4);
  return out;
};
const region = new Uint8ClampedArray(W * H).fill(255);

describe("glow-up kapıları (PLAN 5d; GLOW_UP_GATE)", () => {
  it("eşikler yer tutucu ve belgeli", () => {
    expect(GLOW_UP_GATE.placeholder).toBe(true);
    expect(GLOW_UP_GATE.minTextureRatio).toBeLessThan(1);
    expect(GLOW_UP_GATE.maxTextureRatio).toBeGreaterThan(1);
  });
  it("aynı görsel: doku oranı 1, ton kayması 0, geçer", () => {
    const o = textured(140, 6);
    const r = glowUpGate(o, Uint8ClampedArray.from(o), region, W, H);
    expect(r.textureRatio).toBeCloseTo(1, 5);
    expect(Math.abs(r.toneShift)).toBeLessThan(1e-6);
    expect(r.ok).toBe(true);
    expect(r.pixels).toBe(W * H);
  });
  it("aşırı pürüzsüz çıktı (doku silinmiş) → skin_over_smoothed, gösterilmez", () => {
    const o = textured(140, 6);
    const r = glowUpGate(o, flat(140), region, W, H);
    expect(r.textureRatio).toBeLessThan(GLOW_UP_GATE.minTextureRatio);
    expect(r).toMatchObject({ ok: false, reason: "skin_over_smoothed" });
  });
  it("doku uydurma (orijinalin çok üstünde yüksek frekans) → skin_texture_artifact", () => {
    const o = textured(140, 2);
    const r = glowUpGate(o, textured(140, 12, 3), region, W, H);
    expect(r).toMatchObject({ ok: false, reason: "skin_texture_artifact" });
  });
  it("ten rengi kayması (L* > eşik) → skin_tone_shift; küçük kayma (ton eşitleme) geçer", () => {
    const o = textured(120, 6);
    const big = glowUpGate(o, textured(190, 6), region, W, H);
    expect(Math.abs(big.toneShift)).toBeGreaterThan(GLOW_UP_GATE.maxSkinToneShift);
    expect(big).toMatchObject({ ok: false, reason: "skin_tone_shift" });
    const small = glowUpGate(o, textured(126, 6), region, W, H);
    expect(Math.abs(small.toneShift)).toBeLessThan(GLOW_UP_GATE.maxSkinToneShift);
    expect(small.ok).toBe(true);
  });
  it("bölge dışı pikseller ölçüme girmez; boş bölge geçer", () => {
    const o = textured(140, 6);
    const empty = new Uint8ClampedArray(W * H);
    expect(glowUpGate(o, flat(0), empty, W, H)).toMatchObject({ ok: true, pixels: 0 });
    const half = new Uint8ClampedArray(W * H);
    for (let p = 0; p < (W * H) / 2; p++) half[p] = 255;
    const out = Uint8ClampedArray.from(o);
    for (let p = (W * H) / 2; p < W * H; p++) out.set([0, 0, 0, 255], p * 4); // alt yarı bozuk ama bölge dışı
    expect(glowUpGate(o, out, half, W, H).ok).toBe(true);
  });
  it("yüksek frekans geri yazımı: pürüzsüz çıktıya orijinal doku s gücünde döner; bölge dışı ve alfa değişmez", () => {
    const o = textured(140, 6);
    const smooth = flat(150); // model tonu 10 açtı ve dokuyu sildi
    const before = textureEnergy(lumaPlane(smooth, W, H), W, H, region);
    const reg = new Uint8ClampedArray(W * H);
    for (let p = 0; p < W * H; p++) reg[p] = p % W < 32 ? 255 : 0; // sol yarı
    const out = rewriteHighFrequency(Uint8ClampedArray.from(smooth), o, reg, W, H, 0.5);
    const eo = textureEnergy(lumaPlane(o, W, H), W, H, reg), eg = textureEnergy(lumaPlane(out, W, H), W, H, reg);
    expect(before).toBe(0);
    expect(eg / eo).toBeGreaterThan(0.4);
    expect(eg / eo).toBeLessThan(0.6);
    // düşük frekans (ton) modelden kalır: ortalama ≈ 150
    const l = lumaPlane(out, W, H);
    let sum = 0, n = 0;
    for (let p = 0; p < W * H; p++) if (reg[p]) { sum += l[p]; n++; }
    expect(sum / n).toBeGreaterThan(147);
    expect(sum / n).toBeLessThan(153);
    for (let p = 0; p < W * H; p++) {
      if (!reg[p]) expect(out[p * 4]).toBe(150);
      expect(out[p * 4 + 3]).toBe(255);
    }
    expect(rewriteHighFrequency(Uint8ClampedArray.from(smooth), o, reg, W, H, 0)[5 * 4]).toBe(150);
  });
  it("yardımcılar: L* monoton; kutu bulanıklığı sabit düzlemi korur", () => {
    expect(lumaToLStar(0)).toBe(0);
    expect(lumaToLStar(255)).toBeCloseTo(100, 0);
    expect(lumaToLStar(128)).toBeGreaterThan(lumaToLStar(64));
    const plane = new Float32Array(W * H).fill(77);
    expect(boxBlurPlane(plane, W, H)[100]).toBeCloseTo(77, 5);
    expect(skinToneShift(plane, new Float32Array(W * H).fill(77), region)).toBe(0);
  });
});
