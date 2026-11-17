import { describe, expect, it } from "vitest";
import { compositePixels } from "@/lib/tryon/pixels";

function rgba(w: number, h: number, v: number) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < a.length; i += 4) { a[i] = a[i + 1] = a[i + 2] = v; a[i + 3] = 255; }
  return a;
}

describe("compositePixels (SPEC 10.4 adım 3–5, saf çekirdek)", () => {
  it("maske 255 → C birebir, 0 → G', arada karışım; alfa 255", () => {
    const W = 4, H = 1;
    const gp = rgba(W, H, 200), cp = rgba(W, H, 100);
    const mask = new Uint8ClampedArray([255, 0, 128, 255]);
    const r = compositePixels(gp, cp, mask, W, H);
    // kenar bandı (mask 128) fark 100 > 18 → G' maske dışında gain 0,8 ile koyulaşır (200 → 160); web worker ile aynı kural
    expect([r.out[0], r.out[4], r.out[12]]).toEqual([100, 160, 100]);
    expect(r.out[8]).toBeCloseTo(160 * (1 - 128 / 255) + 100 * (128 / 255), 0);
    expect(r.out[3]).toBe(255);
  });
  it("kenar bandında büyük parlaklık farkı → G' ton düzeltmesi (yalnız maske dışı)", () => {
    const W = 3, H = 1;
    const gp = rgba(W, H, 200), cp = rgba(W, H, 100);
    const mask = new Uint8ClampedArray([255, 128, 0]);
    const r = compositePixels(gp, cp, mask, W, H);
    expect(r.toneAdjusted).toBe(true);
    expect(r.edgeLumaDiff).toBeCloseTo(100, 5);
    expect(gp[0]).toBe(200); // maskede 255 olan piksel değişmez
    expect(gp[8]).toBeLessThan(200); // maske dışı koyulaştı (gain 0,8 alt sınır)
    expect(r.out[0]).toBe(100);
  });
  it("küçük fark → düzeltme yok", () => {
    const r = compositePixels(rgba(2, 1, 110), rgba(2, 1, 100), new Uint8ClampedArray([128, 0]), 2, 1);
    expect(r.toneAdjusted).toBe(false);
  });
});
