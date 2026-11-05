import { describe, expect, it } from "vitest";
import { alignmentResidual, applySimilarity, estimateSimilarity, similarityAngleDeg, similarityScale } from "@/lib/tryon/align";

const pts = [
  { x: 100, y: 120 }, { x: 300, y: 118 }, { x: 150, y: 125 }, { x: 250, y: 124 }, { x: 200, y: 160 }, { x: 200, y: 220 }, { x: 200, y: 330 },
];
function transform(s: number, deg: number, tx: number, ty: number) {
  const r = (deg * Math.PI) / 180;
  return pts.map((p) => ({ x: s * (Math.cos(r) * p.x - Math.sin(r) * p.y) + tx, y: s * (Math.sin(r) * p.x + Math.cos(r) * p.y) + ty }));
}

describe("estimateSimilarity (SPEC 10.4 adım 2)", () => {
  it("bilinen ölçek/döndürme/ötelemeyi geri bulur", () => {
    const dst = transform(1.3, 7, 40, -25);
    const t = estimateSimilarity(pts, dst);
    expect(similarityScale(t)).toBeCloseTo(1.3, 6);
    expect(similarityAngleDeg(t)).toBeCloseTo(7, 6);
    for (let i = 0; i < pts.length; i++) {
      const p = applySimilarity(t, pts[i]);
      expect(p.x).toBeCloseTo(dst[i].x, 6);
      expect(p.y).toBeCloseTo(dst[i].y, 6);
    }
    expect(alignmentResidual(t, pts, dst, 100)).toBeCloseTo(0, 6);
  });
  it("gürültülü eşleşmede artık göz bebeği mesafesine göre ölçeklenir", () => {
    const dst = transform(1, 0, 0, 0).map((p, i) => ({ x: p.x + (i % 2 ? 2 : -2), y: p.y + (i % 3 ? 1 : -1) }));
    const t = estimateSimilarity(pts, dst);
    const res = alignmentResidual(t, pts, dst, 100);
    expect(res).toBeGreaterThan(0);
    expect(res).toBeLessThan(0.04);
    expect(alignmentResidual(t, pts, dst, 10)).toBeGreaterThan(res);
  });
  it("yansıma üretmez (ölçek pozitif), 2'den az nokta hata", () => {
    const t = estimateSimilarity(pts, transform(0.5, -30, 10, 10));
    expect(similarityScale(t)).toBeGreaterThan(0);
    expect(() => estimateSimilarity([pts[0]], [pts[0]])).toThrow();
  });
});
