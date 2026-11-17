import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FACE_SHAPE_THRESHOLDS as T, FACE_SHAPE_VERSION, MESH_TOP_TO_HAIRLINE, classifyFaceShape, effectiveLengthRatio } from "@/lib/face/faceShape";
import { computeMetrics } from "@/lib/face/metrics";
import type { Point } from "@/lib/face/types";
import { SHAPE_PARAMS, syntheticFace } from "../helpers/syntheticFace";

/** Etkin uzunluk doğrudan verilir (saç çizgisi bulunmuş gibi: faceLengthRatio = length). */
const shape = (length: number, jawRatio: number, foreheadRatio: number) =>
  classifyFaceShape({ lengthRatio: length / MESH_TOP_TO_HAIRLINE, faceLengthRatio: length, jawRatio, foreheadRatio });

describe("fs-v2 etkin uzunluk (KB §4.10, PLAN 1d)", () => {
  it("saç çizgisi bulunduysa faceLengthRatio, yoksa lengthRatio × 1,12", () => {
    expect(FACE_SHAPE_VERSION).toBe("fs-v2");
    expect(effectiveLengthRatio({ lengthRatio: 1.2, faceLengthRatio: 1.35, jawRatio: 0.85, foreheadRatio: 0.9 })).toBe(1.35);
    expect(effectiveLengthRatio({ lengthRatio: 1.2, faceLengthRatio: null, jawRatio: 0.85, foreheadRatio: 0.9 })).toBeCloseTo(1.344, 6);
    expect(effectiveLengthRatio({ lengthRatio: 1.2, jawRatio: 0.85, foreheadRatio: 0.9 })).toBeCloseTo(1.344, 6);
  });
  it("v1'de 'Yuvarlak' çıkan tipik oval (ağ tepesi 1,20–1,25, çene < 0,90) artık oval", () => {
    // Ağ tepesi uzunluğu 1,22 → etkin 1,37: yuvarlak eşiğinin (1,22) çok üstünde, uzun eşiğinin (1,42) altında.
    expect(classifyFaceShape({ lengthRatio: 1.22, jawRatio: 0.85, foreheadRatio: 0.88 }).primary).toBe("oval");
    expect(classifyFaceShape({ lengthRatio: 1.15, jawRatio: 0.86, foreheadRatio: 0.88 }).primary).toBe("oval");
  });
  it("uzun yüz (ağ tepesi ≥ 1,27) 'Yuvarlak' çıkmaz; uzun olur", () => {
    expect(classifyFaceShape({ lengthRatio: 1.3, jawRatio: 0.85, foreheadRatio: 0.88 }).primary).toBe("long");
  });
});

describe("classifyFaceShape kural sırası (etkin uzunluk ölçeğinde)", () => {
  it("uzun: etkin uzunluk ≥ 1,42 her şeyden önce gelir", () => {
    expect(shape(1.42, 0.95, 0.95).primary).toBe("long");
    expect(shape(1.419, 0.95, 0.95).primary).not.toBe("long");
  });
  it("kare: jaw ≥ 0,90 ve uzunluk < 1,32", () => {
    expect(shape(1.2, 0.9, 0.85).primary).toBe("square");
    expect(shape(1.32, 0.9, 0.85).primary).not.toBe("square");
    expect(shape(1.1, 0.899, 0.85).primary).toBe("round");
  });
  it("yuvarlak: uzunluk < 1,22 ve jaw < 0,90", () => {
    expect(shape(1.21, 0.85, 0.85).primary).toBe("round");
    expect(shape(1.22, 0.85, 0.85).primary).not.toBe("round");
  });
  it("kalp: forehead ≥ jaw + 0,10", () => {
    expect(shape(1.32, 0.8, 0.9).primary).toBe("heart");
    expect(shape(1.32, 0.8, 0.899).primary).not.toBe("heart");
  });
  it("elmas: forehead < 0,80 ve jaw < 0,80", () => {
    expect(shape(1.32, 0.75, 0.75).primary).toBe("diamond");
    expect(shape(1.32, 0.8, 0.75).primary).toBe("oval");
  });
  it("hiçbiri → oval", () => {
    expect(shape(1.32, 0.84, 0.88).primary).toBe("oval");
  });
  it("eşik değerleri KB/PLAN başlangıç değerleri", () => {
    expect(T.roundLengthMax).toBe(1.22);
    expect(T.longLengthMin).toBe(1.42);
    expect(MESH_TOP_TO_HAIRLINE).toBe(1.12);
  });
});

describe("güven ve en yakın ikinci şekil (KB: 'Kare, ovale yakın')", () => {
  it("eşiğin tam üstünde güven düşük; ikinci şekil birincilden farklı", () => {
    const r = shape(1.43, 0.84, 0.88); // long eşiğine 0,01 uzak
    expect(r.primary).toBe("long");
    expect(r.confidence).toBeLessThan(0.3);
    expect(r.secondary).toBe("oval");
  });
  it("eşiklerden uzakta güven yüksek; ikinci şekil yine verilir (en yakın iki şekil)", () => {
    const r = shape(1.75, 0.84, 0.88);
    expect(r.confidence).toBe(1);
    expect(r.secondary).toBeDefined();
    expect(r.secondary).not.toBe("long");
  });
  it("oval ile yuvarlak arası: yuvarlağı az farkla kaçıran yüz ikinci şekil olarak yuvarlak verir", () => {
    const r = shape(1.23, 0.85, 0.85);
    expect(r.primary).toBe("oval");
    expect(r.secondary).toBe("round");
    expect(r.confidence).toBeLessThan(0.3);
  });
  it("kare, ovale yakın", () => {
    const r = shape(1.31, 0.91, 0.9);
    expect(r.primary).toBe("square");
    expect(r.secondary).toBe("oval");
  });
  it("güven 0–1 aralığında ve ikinci şekil asla birincille aynı değil", () => {
    for (const [l, j, f] of [[1.0, 0.5, 0.5], [2.0, 1.2, 1.2], [1.32, 0.84, 0.88], [1.1, 0.95, 0.7]]) {
      const r = shape(l, j, f);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
      expect(r.secondary).not.toBe(r.primary);
    }
  });
});

describe("sentetik fixture'lar (tests/fixtures/landmarks)", () => {
  const dir = path.resolve(__dirname, "..", "fixtures", "landmarks");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  it("6 şekil için fixture var", () => {
    expect(files.sort()).toEqual(["diamond.json", "heart.json", "long.json", "oval.json", "round.json", "square.json"]);
  });
  for (const file of files) {
    it(`${file}: beklenen şekli verir`, () => {
      const fx = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as { expectedShape: string; width: number; height: number; landmarks: [number, number][] };
      const pts: Point[] = fx.landmarks.map(([x, y]) => ({ x: x * fx.width, y: y * fx.height }));
      expect(pts).toHaveLength(478);
      const m = computeMetrics(pts, null);
      expect(m.faceLengthRatio).toBeNull();
      expect(classifyFaceShape(m).primary).toBe(fx.expectedShape);
    });
  }
  it("SHAPE_PARAMS üretimi fixture'larla tutarlı", () => {
    for (const [name, p] of Object.entries(SHAPE_PARAMS)) {
      expect(classifyFaceShape(computeMetrics(syntheticFace(p), null)).primary).toBe(name);
    }
  });
  it("saç çizgisi verilince faceLengthRatio ölçülür ve sınıflama ona dayanır", () => {
    const L = syntheticFace(SHAPE_PARAMS.round);
    // Saç çizgisi ağ tepesinin çok üstünde: yüz aslında uzun → "round" yerine "long" / "oval".
    const m = computeMetrics(L, L[10].y - 0.6 * 98);
    expect(m.hairlineFound).toBe(true);
    expect(m.faceLengthRatio).toBeGreaterThan(1.42);
    expect(classifyFaceShape(m).primary).toBe("long");
  });
});
