// Hayalet kılavuz (KB §8 R2-Ö1; CONTRACTS_V2 Sprint 3 S3.3): cihazda üretilen çizgi altkümesi; 478 nokta saklanmaz.
import { describe, expect, it } from "vitest";
import { FACE_OVAL, LANDMARK_COUNT } from "@/lib/face/indices";
import { GHOST_INDICES, GHOST_POINT_COUNT, GhostOutline, ghostOutlineFromLandmarks, ghostPolylines, parseGhostOutline, polylinePath } from "@/lib/face/ghostGuide";
import type { Point } from "@/lib/face/types";

const W = 640, H = 480;
const landmarks: Point[] = Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: (i % 64) * 10, y: Math.floor(i / 64) * 60, z: 0.1 }));

describe("altküme", () => {
  it("43 nokta: oval + 4 göz köşesi + burun ucu + 2 ağız köşesi; tekrar yok", () => {
    expect(GHOST_POINT_COUNT).toBe(FACE_OVAL.length + 7);
    expect(new Set(GHOST_INDICES).size).toBe(GHOST_POINT_COUNT);
    expect(GHOST_POINT_COUNT).toBeLessThan(70);
  });
  it("landmark'tan normalize çizgi; z ve diğer noktalar atılır; şema geçer", () => {
    const o = ghostOutlineFromLandmarks(landmarks, W, H, { mirrored: true, takenAt: 1_700_000_000_000 });
    expect(o).not.toBeNull();
    expect(GhostOutline.safeParse(o).success).toBe(true);
    expect(o!.oval).toHaveLength(FACE_OVAL.length);
    expect(o!.aspect).toBeCloseTo(W / H, 3);
    expect(JSON.stringify(o)).not.toContain('"z"');
    expect(o!.oval[0][0]).toBeCloseTo(landmarks[FACE_OVAL[0]].x / W, 3);
    expect(o!.oval[0][1]).toBeCloseTo(landmarks[FACE_OVAL[0]].y / H, 3);
    for (const [x, y] of o!.oval) expect(x >= 0 && x <= 1 && y >= 0 && y <= 1).toBe(true);
  });
  it("eksik nokta ya da geçersiz kare → null; bozuk kayıt → null", () => {
    expect(ghostOutlineFromLandmarks(landmarks.slice(0, 100), W, H, { mirrored: false, takenAt: 0 })).toBeNull();
    expect(ghostOutlineFromLandmarks(landmarks, 0, H, { mirrored: false, takenAt: 0 })).toBeNull();
    expect(parseGhostOutline({ version: 2 })).toBeNull();
    expect(parseGhostOutline(ghostOutlineFromLandmarks(landmarks, W, H, { mirrored: false, takenAt: 5 }))).not.toBeNull();
  });
});

describe("önizlemeye eşleme", () => {
  const o = ghostOutlineFromLandmarks(landmarks, W, H, { mirrored: true, takenAt: 1 })!;
  it("aynı oran, aynı ayna: ölçek doğrudan", () => {
    const p = ghostPolylines(o, { w: 320, h: 240 }, { mirror: true });
    expect(p.oval[0][0]).toBeCloseTo(landmarks[FACE_OVAL[0]].x / 2, 0);
    expect(p.oval[0][1]).toBeCloseTo(landmarks[FACE_OVAL[0]].y / 2, 0);
    expect(Object.is(p.oval[0][1], -0)).toBe(false);
    expect(p.nose[0]).toBeGreaterThanOrEqual(0);
  });
  it("ayna farkı x'i çevirir; cover eşlemesi dikey önizlemede yatay taşar", () => {
    const a = ghostPolylines(o, { w: 320, h: 240 }, { mirror: true });
    const b = ghostPolylines(o, { w: 320, h: 240 }, { mirror: false });
    expect(b.oval[0][0]).toBeCloseTo(320 - a.oval[0][0], 0);
    expect(b.oval[0][1]).toBe(a.oval[0][1]);
    const portrait = ghostPolylines(o, { w: 360, h: 640 }, { mirror: true });
    // cover: ölçek = max(360/1.333, 640/1) = 640 → genişlik 853, sola -246 ofset
    expect(portrait.oval.some(([x]) => x < 0 || x > 360)).toBe(true);
    expect(portrait.oval.every(([, y]) => y >= 0 && y <= 640)).toBe(true);
  });
  it("yol dizgesi", () => {
    expect(polylinePath([[1, 2], [3, 4]], true)).toBe("M1,2 L3,4 Z");
    expect(polylinePath([])).toBe("");
  });
});
