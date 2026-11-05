import { describe, expect, it } from "vitest";
import { FACE_OVAL, IDX, LANDMARK_COUNT } from "@/lib/face/indices";
import { OVERLAY_LAYER_KEYS, faceCrop, notMeasuredLayers, overlayLayers } from "@/lib/face/overlay";
import type { Point } from "@/lib/face/types";

/** Yalnız testte kullanılan sentetik nokta dizisi: i. nokta (i, 2i). Gerçek yüz verisi değil. */
function synthetic(n = LANDMARK_COUNT): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: 2 * i }));
}

describe("overlayLayers (UI spec §2.5)", () => {
  it("tüm katmanlar ve doğru noktalar", () => {
    const lm = synthetic();
    const L = overlayLayers(lm);
    expect(Object.keys(L)).toEqual([...OVERLAY_LAYER_KEYS]);

    expect(L.oval).toHaveLength(1);
    expect(L.oval[0]).toHaveLength(FACE_OVAL.length + 1);
    expect(L.oval[0][0]).toEqual(L.oval[0][FACE_OVAL.length]); // kapalı

    expect(L.midline[0].map(([x]) => x)).toEqual([10, 9, 168, 1, 2, 152]);

    // Dikey oranlar: y9, y2, y152 hizasında x234 → x454
    expect(L.vertical).toEqual([
      [[IDX.cheekR, 2 * 9], [IDX.cheekL, 2 * 9]],
      [[IDX.cheekR, 2 * 2], [IDX.cheekL, 2 * 2]],
      [[IDX.cheekR, 2 * 152], [IDX.cheekL, 2 * 152]],
    ]);

    expect(L.eyeAxis.map((l) => l.map(([x]) => x))).toEqual([[133, 33], [362, 263]]);
    expect(L.spacing.map((l) => l.map(([x]) => x))).toEqual([[468, 473]]);
    expect(L.widths.map((l) => l.map(([x]) => x))).toEqual([[234, 454], [172, 397]]);
  });

  it("iris noktaları yoksa göz aralığı çizilmez, diğerleri kalır", () => {
    const L = overlayLayers(synthetic(468));
    expect(L.spacing).toEqual([]);
    expect(L.midline).toHaveLength(1);
  });

  it("boş dizi → boş katmanlar", () => {
    const L = overlayLayers([]);
    for (const k of OVERLAY_LAYER_KEYS) expect(L[k]).toEqual([]);
  });
});

describe("faceCrop", () => {
  const box: Point[] = [
    { x: 400, y: 300 },
    { x: 600, y: 600 },
  ];

  it("kutu + her yana %25 dolgu", () => {
    expect(faceCrop(box, 1000, 1000)).toEqual({ x: 350, y: 225, width: 300, height: 450 });
  });

  it("görüntü sınırlarına sığar", () => {
    const r = faceCrop([{ x: 0, y: 0 }, { x: 100, y: 100 }], 120, 120, 0.5);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(120);
    expect(r.y + r.height).toBeLessThanOrEqual(120);
  });

  it("en-boy oranı tutturulur (küçük resim 4:5)", () => {
    const r = faceCrop(box, 1000, 1000, 0.25, 0.8);
    expect(r.width / r.height).toBeCloseTo(0.8, 5);
    expect(r.height).toBeCloseTo(450, 5);
    // Görüntüden büyükse oran korunarak küçülür
    const s = faceCrop(box, 1000, 300, 0.25, 0.8);
    expect(s.width / s.height).toBeCloseTo(0.8, 5);
    expect(s.height).toBeLessThanOrEqual(300);
  });

  it("nokta yoksa tüm görüntü", () => {
    expect(faceCrop([], 640, 480)).toEqual({ x: 0, y: 0, width: 640, height: 480 });
  });
});

describe("notMeasuredLayers", () => {
  it("yalnız not_measured yapısal öğelerin katmanları; göz–ağız katmansız", () => {
    expect(
      notMeasuredLayers([
        { key: "symmetry", status: "measured" },
        { key: "tilt", status: "not_measured" },
        { key: "jawWidth", status: "not_measured" },
        { key: "eyeMouth", status: "not_measured" },
        { key: "shine", status: "partial" },
      ]),
    ).toEqual(["eyeAxis", "widths"]);
    expect(notMeasuredLayers([])).toEqual([]);
  });
});
