import { describe, expect, it } from "vitest";
import { IDX } from "@/lib/face/indices";
import { d, frameSymmetry, rollCorrect } from "@/lib/face/metrics";
import { EYE_PAIRS, LOWER_PAIRS, MID_PAIRS, computeSymmetry, derotate, rotationFromMatrix } from "@/lib/face/symmetry";
import type { FrameAnalysis, Point } from "@/lib/face/types";
import { FRAME_H, FRAME_W, frontalFace, poseMatrix, posedFace, toNormalized } from "../helpers/mirroredFace";

const W = 300;

function frameOf(pts: Point[], matrix: number[] | null): Pick<FrameAnalysis, "landmarks" | "width" | "height" | "matrix"> {
  return { landmarks: toNormalized(pts), width: FRAME_W, height: FRAME_H, matrix };
}

describe("computeSymmetry (engine spec §3.3)", () => {
  it("ayna simetrik yüz 0 verir", () => {
    const L = frontalFace();
    expect(d(L[IDX.cheekR], L[IDX.cheekL])).toBe(W);
    const s = computeSymmetry(L, W);
    expect(s.face).toBeCloseTo(0, 10);
    expect(s.eyes).toBeCloseTo(0, 10);
    expect(s.lower).toBeCloseTo(0, 10);
  });

  it("bir sol noktayı 0,02 W dışa almak beklenen RMS'i verir", () => {
    const L = frontalFace();
    L[291] = { ...L[291], x: L[291].x + 0.02 * W };
    const s = computeSymmetry(L, W);
    const nAll = EYE_PAIRS.length + MID_PAIRS.length + LOWER_PAIRS.length;
    expect(s.face).toBeCloseTo(0.02 / Math.sqrt(nAll), 9);
    expect(s.lower).toBeCloseTo(0.02 / Math.sqrt(LOWER_PAIRS.length + 1), 9);
    expect(s.eyes).toBeCloseTo(0, 10);
  });

  it("dikey kayma b terimiyle ölçülür; ortak kip çıkarılır", () => {
    const L = frontalFace();
    L[386] = { ...L[386], y: L[386].y - 0.03 * W };
    expect(computeSymmetry(L, W).eyes).toBeCloseTo(0.03 / Math.sqrt(EYE_PAIRS.length), 9);
    // Tüm sol noktaların aynı kayması (ortak kip) ölçülmez: önden çekimin dürüst sınırı.
    const shifted = frontalFace().map((p, i) =>
      [...EYE_PAIRS, ...MID_PAIRS, ...LOWER_PAIRS].some(([, l]) => l === i) ? { ...p, y: p.y + 6 } : p,
    );
    expect(computeSymmetry(shifted, W).face).toBeCloseTo(0, 9);
  });

  it("çene orta hattan kayınca lower değişir, eyes değişmez", () => {
    const L = frontalFace();
    L[IDX.menton] = { ...L[IDX.menton], x: 0.03 * W };
    const s = computeSymmetry(L, W);
    expect(s.lower).toBeCloseTo(0.03 / Math.sqrt(LOWER_PAIRS.length + 1), 9);
    expect(s.eyes).toBeCloseTo(0, 10);
  });

  it("geçersiz yüz genişliğinde fırlatır", () => {
    expect(() => computeSymmetry(frontalFace(), 0)).toThrow("face_width_invalid");
  });
});

describe("de-rotasyon", () => {
  it("rotationFromMatrix ölçeği atar ve kısa diziyi reddeder", () => {
    const R = rotationFromMatrix(poseMatrix(0, 6, 0, 3.5))!;
    expect(Math.hypot(R[0][0], R[1][0], R[2][0])).toBeCloseTo(1, 12);
    expect(rotationFromMatrix([1, 0, 0])).toBeNull();
    expect(derotate(frontalFace(), [1, 2])).toBeNull();
  });

  it("döndürülmüş yüzü önden hale getirir (öteleme dışında)", () => {
    const base = frontalFace();
    const back = derotate(posedFace({ yaw: 6, pitch: 4, roll: 2 }, base), poseMatrix(4, 6, 2))!;
    const dx = back[IDX.noseTip].x - base[IDX.noseTip].x;
    const dy = back[IDX.noseTip].y - base[IDX.noseTip].y;
    for (const i of [IDX.cheekR, IDX.menton, 58, 386]) {
      expect(back[i].x - base[i].x).toBeCloseTo(dx, 9);
      expect(back[i].y - base[i].y).toBeCloseTo(dy, 9);
    }
  });

  it.each([3, 6, -6])("yaw %d° ayna yüzde de-rotasyondan sonra face/eyes/lower < 0,005", (yaw) => {
    const s = frameSymmetry(frameOf(posedFace({ yaw }), poseMatrix(0, yaw, 0)))!;
    expect(s.face).toBeLessThan(0.005);
    expect(s.eyes).toBeLessThan(0.005);
    expect(s.lower).toBeLessThan(0.005);
  });

  it("de-rotasyon olmadan aynı kare ölçülebilir asimetri gösterirdi (derinlik farkı)", () => {
    const L = rollCorrect(toNormalized(posedFace({ yaw: 6 })).map((p) => ({ x: p.x * FRAME_W, y: p.y * FRAME_H }))).points;
    expect(computeSymmetry(L, d(L[IDX.cheekR], L[IDX.cheekL])).face).toBeGreaterThan(0.005);
  });

  it("matrissiz karede null; çıktıda x/y anahtarı yok", () => {
    expect(frameSymmetry(frameOf(frontalFace(), null))).toBeNull();
    const s = frameSymmetry(frameOf(frontalFace(), poseMatrix(0, 0, 0)))!;
    expect(Object.keys(s).sort()).toEqual(["eyes", "face", "lower"]);
    expect(JSON.stringify(s)).not.toMatch(/"x"|"y"/);
  });
});
