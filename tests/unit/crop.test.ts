import { describe, expect, it } from "vitest";
import { SERVER_CROP_SIZE, computeCropBox, landmarksToCrop } from "@/lib/face/crop";
import { syntheticFace } from "../helpers/syntheticFace";

describe("computeCropBox (SPEC 7.2 adım 4)", () => {
  it("kare, yüzü ve üstünde saç payını içerir, görüntü içinde kalır", () => {
    const pts = syntheticFace({ cheek: 300, length: 420, jaw: 250, forehead: 260, cx: 640, cy: 640 });
    const box = computeCropBox(pts, 1280, 1280);
    expect(box.size).toBeGreaterThanOrEqual(420 * 1.5);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.size).toBeLessThanOrEqual(1280);
    expect(box.y + box.size).toBeLessThanOrEqual(1280);
    const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
    expect(box.y).toBeLessThan(minY); // üstte pay var
    expect(box.y + box.size).toBeGreaterThan(maxY);
  });
  it("yüz kenara yakınsa kutu kaydırılır, küçük görüntüde kenara sığdırılır", () => {
    const pts = syntheticFace({ cheek: 300, length: 420, jaw: 250, forehead: 260, cx: 150, cy: 300 });
    const box = computeCropBox(pts, 720, 960);
    expect(box.x).toBe(0);
    expect(box.size).toBeLessThanOrEqual(720);
  });
  it("landmarksToCrop kırpım koordinatına ölçekler", () => {
    const out = landmarksToCrop([{ x: 100, y: 200 }], { x: 50, y: 100, size: 400 }, SERVER_CROP_SIZE);
    expect(out[0].x).toBeCloseTo((50 * 768) / 400);
    expect(out[0].y).toBeCloseTo((100 * 768) / 400);
  });
});
