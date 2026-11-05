import { describe, expect, it } from "vitest";
import { faceBoxToPixels, pixelStatsFromRgba } from "@/lib/face/pixelStats";

function rgba(w: number, h: number, fn: (x: number, y: number) => number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = fn(x, y); const i = (y * w + x) * 4; a[i] = a[i + 1] = a[i + 2] = v; a[i + 3] = 255; }
  return a;
}

describe("pixelStatsFromRgba (SPEC 7.3, web worker ve mobil ortak)", () => {
  it("düz gri: parlaklık sabit, denge 0, netlik 0", () => {
    const s = pixelStatsFromRgba(rgba(64, 64, () => 120), 64, 64);
    expect(s.brightness).toBeCloseTo(120, 5);
    expect(s.brightnessBalance).toBeCloseTo(0, 5);
    expect(s.sharpness).toBeCloseTo(0, 5);
  });
  it("sol karanlık sağ aydınlık: denge büyük; damalı doku: netlik yüksek", () => {
    const uneven = pixelStatsFromRgba(rgba(64, 64, (x) => (x < 32 ? 40 : 200)), 64, 64);
    expect(uneven.brightnessBalance).toBeGreaterThan(100);
    const checker = pixelStatsFromRgba(rgba(64, 64, (x, y) => ((x + y) % 2 ? 0 : 255)), 64, 64);
    expect(checker.sharpness).toBeGreaterThan(1000);
  });
  it("çok küçük veya eksik veri null döner; kutu dönüşümü sınırlara sığar", () => {
    expect(pixelStatsFromRgba(new Uint8ClampedArray(4 * 4 * 4), 4, 4)).toEqual({ brightness: null, brightnessBalance: null, sharpness: null });
    expect(faceBoxToPixels({ minX: -0.1, minY: 0.2, maxX: 1.2, maxY: 0.6 }, 256)).toEqual({ x0: 0, y0: 51, w: 256, h: 103 });
  });
});
