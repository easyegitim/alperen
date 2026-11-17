import { estimateSimilarity } from "@/lib/tryon/align";
import { scalePoints, similarityToMatrix } from "@/mobile/src/features/tryon/matrix";

describe("deneme kompoziti yardımcıları (SPEC 10.4)", () => {
  it("benzerlik dönüşümü Skia matrisine canvas.setTransform ile aynı yerleşimde çevrilir", () => {
    const src = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    const dst = [{ x: 5, y: 5 }, { x: 25, y: 5 }, { x: 5, y: 25 }];
    const t = estimateSimilarity(src, dst); // ölçek 2, öteleme (5,5)
    const m = similarityToMatrix(t);
    expect(m[0]).toBeCloseTo(2, 5);
    expect(m[4]).toBeCloseTo(2, 5);
    expect(m[2]).toBeCloseTo(5, 5);
    expect(m[5]).toBeCloseTo(5, 5);
    expect(m.slice(6)).toEqual([0, 0, 1]);
    // noktayı uygula: x' = a x − b y + tx
    const p = { x: 10, y: 10 };
    expect(m[0] * p.x + m[1] * p.y + m[2]).toBeCloseTo(25, 5);
  });
  it("G noktaları C boyutuna ölçeklenir", () => {
    expect(scalePoints([{ x: 50, y: 20 }], 2, 0.5)).toEqual([{ x: 100, y: 10 }]);
  });
});
