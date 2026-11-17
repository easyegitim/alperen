import { describe, expect, it } from "vitest";
import { FACE_OVAL, IDX } from "@/lib/face/indices";
import { buildProtectMask, faceOvalPolygon, pointInPolygon, rasterizeMask } from "@/lib/tryon/mask";
import { syntheticFace } from "../helpers/syntheticFace";

const W = 300, H = 300;
// Sentetik yüzde FACE_OVAL noktaları sırayla elips üzerine yerleştirilir (gerçek ağda oval saat yönünde sıralıdır).
const L = syntheticFace({ cheek: 120, length: 160, jaw: 100, forehead: 105, cx: 150, cy: 150 });
FACE_OVAL.forEach((idx, k) => {
  const a = -Math.PI / 2 + (k / FACE_OVAL.length) * Math.PI * 2;
  L[idx] = { x: 150 + 62 * Math.cos(a), y: 150 + 84 * Math.sin(a), z: 0 };
});
const at = (m: Uint8ClampedArray, x: number, y: number) => m[Math.round(y) * W + Math.round(x)];

describe("koruma maskesi (SPEC 10.4 adım 3)", () => {
  it("pointInPolygon ve yüz ovali 36 nokta", () => {
    expect(faceOvalPolygon(L)).toHaveLength(36);
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon(5, 5, sq)).toBe(true);
    expect(pointInPolygon(15, 5, sq)).toBe(false);
  });
  it("below_brows: göz, burun, ağız, çene korunur; alın ve dış alan modele kalır", () => {
    const m = rasterizeMask(L, W, H, "below_brows");
    expect(at(m, L[IDX.noseTip].x, L[IDX.noseTip].y)).toBe(255);
    expect(at(m, L[IDX.eyeInnerR].x, L[IDX.eyeInnerR].y)).toBe(255);
    expect(at(m, L[IDX.mouthR].x, L[IDX.mouthR].y)).toBe(255);
    expect(at(m, L[IDX.menton].x, L[IDX.menton].y - 3)).toBe(255);
    expect(at(m, L[IDX.top].x, L[IDX.top].y + 2)).toBe(0); // alın
    expect(at(m, 5, 5)).toBe(0);
  });
  it("above_lip: kaş üstünden burun altına kadar korunur; alt yüz modele kalır", () => {
    const m = rasterizeMask(L, W, H, "above_lip");
    expect(at(m, L[IDX.eyeInnerL].x, L[IDX.eyeInnerL].y)).toBe(255);
    expect(at(m, L[IDX.noseTip].x, L[IDX.noseTip].y)).toBe(255);
    expect(at(m, L[IDX.mouthR].x, L[IDX.mouthR].y)).toBe(0);
    expect(at(m, L[IDX.menton].x, L[IDX.menton].y - 3)).toBe(0);
  });
  it("yumuşatma: iç 255, dış 0, kenarda ara değerler", () => {
    const m = buildProtectMask(L, W, H, "below_brows");
    expect(at(m, L[IDX.noseTip].x, L[IDX.noseTip].y)).toBe(255);
    expect(at(m, 5, 5)).toBe(0);
    const edgeX = L[IDX.cheekR].x; // ovalin kenarı
    const v = at(m, edgeX, L[IDX.cheekR].y);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(255);
  });
});
