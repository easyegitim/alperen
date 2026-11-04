import { describe, expect, it } from "vitest";
import { IDX } from "@/lib/face/indices";
import { computeMetrics, computeStableGeometry, eyeTilt, median, rollCorrect, toPixels } from "@/lib/face/metrics";
import type { FrameAnalysis } from "@/lib/face/types";
import { normalize, syntheticFace } from "../helpers/syntheticFace";
import { FRAME_H, FRAME_W, frontalFace, poseMatrix, posedFace, toNormalized } from "../helpers/mirroredFace";

const base = { cheek: 100, length: 140, jaw: 84, forehead: 90 };

describe("computeMetrics (SPEC 7.5)", () => {
  it("oranlar tanımdan çıkar", () => {
    const m = computeMetrics(syntheticFace(base), null);
    expect(m.lengthRatio).toBeCloseTo(1.4, 6);
    expect(m.jawRatio).toBeCloseTo(0.84, 6);
    expect(m.foreheadRatio).toBeCloseTo(0.9, 6);
    expect(m.fwhr).toBeCloseTo(100 / (140 * 0.45), 6); // cheek / d(0, orta(105,334))
    expect(m.lowerToMiddle).toBeCloseTo(0.43 / 0.34, 6);
    expect(m.hairlineFound).toBe(false);
    expect(m.thirds.upper).toBeNull();
    expect(m.thirds.middle + m.thirds.lower).toBeCloseTo(1, 6);
  });

  it("saç çizgisi varsa üçte birler toplamı 1", () => {
    const L = syntheticFace(base);
    const hairlineY = L[IDX.glabella].y - 0.3 * 140;
    const m = computeMetrics(L, hairlineY);
    expect(m.hairlineFound).toBe(true);
    expect(m.thirds.upper! + m.thirds.middle + m.thirds.lower).toBeCloseTo(1, 6);
    expect(m.thirds.upper).toBeCloseTo(0.3 / (0.3 + 0.34 + 0.43), 6);
  });

  it("saç çizgisi glabella'nın altındaysa (geçersiz) bulunmamış sayılır", () => {
    const L = syntheticFace(base);
    expect(computeMetrics(L, L[IDX.glabella].y + 10).hairlineFound).toBe(false);
  });
});

describe("canthal tilt işareti", () => {
  it("dış köşe yukarıdaysa pozitif, aşağıdaysa negatif, düzse 0", () => {
    expect(computeMetrics(syntheticFace({ ...base, eyeLift: 5 }), null).canthalTiltDeg).toBeGreaterThan(0);
    expect(computeMetrics(syntheticFace({ ...base, eyeLift: -5 }), null).canthalTiltDeg).toBeLessThan(0);
    expect(computeMetrics(syntheticFace(base), null).canthalTiltDeg).toBeCloseTo(0, 6);
  });
  it("eyeTilt her iki göz için aynı işareti verir", () => {
    // sağ göz: iç (120, 100), dış (100, 95) → dış yukarıda → pozitif
    expect(eyeTilt({ x: 120, y: 100 }, { x: 100, y: 95 }, "right")).toBeGreaterThan(0);
    // sol göz: iç (130, 100), dış (150, 95)
    expect(eyeTilt({ x: 130, y: 100 }, { x: 150, y: 95 }, "left")).toBeGreaterThan(0);
    expect(eyeTilt({ x: 120, y: 100 }, { x: 100, y: 95 }, "right")).toBeCloseTo(eyeTilt({ x: 130, y: 100 }, { x: 150, y: 95 }, "left"), 6);
  });
});

describe("rollCorrect", () => {
  it("12° döndürülmüş yüzde roll'u geri bulur ve metrikler değişmez", () => {
    const straight = computeMetrics(syntheticFace(base), null);
    const rolled = syntheticFace({ ...base, rollDeg: 12 });
    const { points, rollDeg } = rollCorrect(rolled);
    expect(rollDeg).toBeCloseTo(12, 5);
    const m = computeMetrics(points, null);
    expect(m.lengthRatio).toBeCloseTo(straight.lengthRatio, 5);
    expect(m.jawRatio).toBeCloseTo(straight.jawRatio, 5);
    expect(m.canthalTiltDeg).toBeCloseTo(straight.canthalTiltDeg, 5);
    expect(m.lowerToMiddle).toBeCloseTo(straight.lowerToMiddle, 5);
  });
});

describe("median ve computeStableGeometry", () => {
  it("median tek ve çift uzunlukta doğru", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  function frame(length: number, extra: Partial<FrameAnalysis> = {}): FrameAnalysis {
    return {
      width: 720,
      height: 960,
      faces: 1,
      landmarks: normalize(syntheticFace({ ...base, length, cx: 360, cy: 480 }), 720, 960),
      blendshapes: null,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      brightness: 130,
      brightnessBalance: 5,
      sharpness: 90,
      hairVisible: true,
      timestamp: 0,
      ...extra,
    };
  }

  it("5 karenin medyanını alır; aykırı kare sonucu bozmaz", () => {
    // fs-v2: ağ tepesi 1,18 → etkin 1,32 (oval bandı); aykırı 170 medyanı bozmaz.
    const frames = [118, 119, 117, 170, 118].map((len) => ({ frame: frame(len), hairline: null }));
    const g = computeStableGeometry(frames);
    expect(g.version).toBe("geo-v1");
    expect(g.metrics.lengthRatio).toBeCloseTo(1.18, 2);
    expect(g.metrics.hairlineFound).toBe(false);
    expect(g.metrics.faceLengthRatio).toBeNull();
    expect(g.quality.brightness).toBe(130);
    expect(g.faceShape.primary).toBe("oval");
  });

  it("en fazla son 5 kare kullanılır ve yüzsüz kareler atlanır", () => {
    const frames = [
      { frame: frame(300), hairline: null },
      { frame: frame(300), hairline: null },
      ...[140, 140, 140, 140, 140].map((len) => ({ frame: frame(len), hairline: null })),
      { frame: frame(140, { faces: 0, landmarks: null }), hairline: null },
    ];
    expect(computeStableGeometry(frames).metrics.lengthRatio).toBeCloseTo(1.4, 2);
  });

  it("yüz yoksa fırlatır; çıktıda ham nokta dizisi yoktur", () => {
    expect(() => computeStableGeometry([{ frame: frame(140, { faces: 0, landmarks: null }), hairline: null }])).toThrow("no_landmarks");
    const g = computeStableGeometry([{ frame: frame(140), hairline: null }]);
    expect(JSON.stringify(g)).not.toContain("landmarks");
    expect(JSON.stringify(g).length).toBeLessThan(600);
  });

  it("toPixels normalize noktaları piksele çevirir", () => {
    expect(toPixels([{ x: 0.5, y: 0.25 }], 720, 960)[0]).toEqual({ x: 360, y: 240, z: undefined });
  });
});

describe("hybrid.v1 metrikleri (engine spec §3.1–3.2)", () => {
  // Ayna yüzde: iris 140/300, göz–ağız (102 − (−40)) / 380.
  const IPD = 140 / 300;
  const EYE_MOUTH = 142 / 380;

  function mframe(pose: { yaw?: number; pitch?: number } = {}, extra: Partial<FrameAnalysis> = {}): FrameAnalysis {
    const yaw = pose.yaw ?? 0;
    const pitch = pose.pitch ?? 0;
    return {
      width: FRAME_W,
      height: FRAME_H,
      faces: 1,
      landmarks: toNormalized(posedFace({ yaw, pitch })),
      blendshapes: null,
      matrix: poseMatrix(pitch, yaw, 0),
      brightness: 130,
      brightnessBalance: 5,
      sharpness: 90,
      hairVisible: true,
      timestamp: 0,
      ...extra,
    };
  }
  const geo = (frames: FrameAnalysis[]) => computeStableGeometry(frames.map((frame) => ({ frame, hairline: null })));

  it("computeMetrics ipdRatio ve eyeMouthRatio'yu verir", () => {
    const m = computeMetrics(frontalFace(), null);
    expect(m.ipdRatio).toBeCloseTo(IPD, 9);
    expect(m.eyeMouthRatio).toBeCloseTo(EYE_MOUTH, 9);
  });

  it("önden kareler: yeni metrikler 3 ondalık ve simetri ~0", () => {
    const g = geo([mframe(), mframe(), mframe()]);
    expect(g.metrics.ipdRatio).toBeCloseTo(IPD, 3);
    expect(g.metrics.eyeMouthRatio).toBeCloseTo(EYE_MOUTH, 3);
    expect(g.metrics.symmetry).toEqual({ face: 0, eyes: 0, lower: 0 });
    expect(String(g.metrics.ipdRatio).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
  });

  it("yaw 4° kareler simetriden çıkarılır; yeterli kare yoksa null", () => {
    // 3 nitelikli + 2 yaw 4° → simetri var
    expect(geo([mframe({ yaw: 4 }), mframe(), mframe({ yaw: 4 }), mframe(), mframe()]).metrics.symmetry).not.toBeNull();
    // 2 nitelikli + 3 yaw 4° → min(3, 5) = 3 kare gerekir → null; ipd (tüm kareler) kalır
    const g = geo([mframe({ yaw: 4 }), mframe(), mframe({ yaw: 4 }), mframe({ yaw: 4 }), mframe()]);
    expect(g.metrics.symmetry).toBeNull();
    expect(g.metrics.ipdRatio).not.toBeNull();
  });

  it("göz–ağız yalnız |pitch| ≤ 8 karelerden; simetri |pitch| ≤ 10", () => {
    const g = geo([mframe({ pitch: 9 }), mframe({ pitch: 9 }), mframe({ pitch: 9 })]);
    expect(g.metrics.eyeMouthRatio).toBeNull();
    expect(g.metrics.symmetry).not.toBeNull();
  });

  it("matrissiz kare yeni medyanlardan çıkarılır", () => {
    const g = geo([mframe({}, { matrix: null }), mframe({}, { matrix: null }), mframe({}, { matrix: null }), mframe(), mframe()]);
    expect(g.metrics.symmetry).toBeNull();
    expect(g.metrics.ipdRatio).toBeNull();
    expect(g.metrics.eyeMouthRatio).toBeNull();
    // Eski metrikler matrissiz karelerden de hesaplanır.
    expect(g.metrics.lengthRatio).toBeGreaterThan(0);
  });

  it("tek kare yeterlidir (min(3, 1)); JSON < 600 karakter, landmarks ve x/y anahtarı yok", () => {
    const g = geo([mframe({ yaw: 2 })]);
    expect(g.metrics.symmetry).not.toBeNull();
    const json = JSON.stringify(g);
    expect(json.length).toBeLessThan(600);
    expect(json).not.toContain("landmarks");
    expect(json).not.toMatch(/"x":|"y":/);
    expect(g.version).toBe("geo-v1");
  });
});
