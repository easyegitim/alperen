import { describe, expect, it } from "vitest";
import { AnalysisInputRaw as AnalysisInput, decodeJpeg } from "@/lib/api/analysesInput";

const jpegBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const geometry = {
  version: "geo-v1",
  quality: { yaw: 1, pitch: 2, roll: 0, brightness: 120, sharpness: 90, passed: true },
  metrics: { lengthRatio: 1.4, jawRatio: 0.84, foreheadRatio: 0.9, fwhr: 1.9, canthalTiltDeg: 3, lowerToMiddle: 1.2, thirds: { upper: null, middle: 0.45, lower: 0.55 }, hairlineFound: false },
  faceShape: { primary: "oval", confidence: 0.8 },
  capturedAt: "2026-10-09T10:00:00Z",
};

describe("AnalysisInput (SPEC 14)", () => {
  it("geçerli gövde", () => {
    expect(AnalysisInput.safeParse({ clientRequestId: crypto.randomUUID(), geometry, image: jpegBytes.toString("base64") }).success).toBe(true);
  });
  it("478 noktalık dizi kabul edilmez (şemada alan yok, metrikler zorunlu)", () => {
    const bad = { ...geometry, metrics: undefined, landmarks: new Array(478).fill([0.1, 0.2]) };
    expect(AnalysisInput.safeParse({ clientRequestId: crypto.randomUUID(), geometry: bad, image: jpegBytes.toString("base64") }).success).toBe(false);
  });
  it("clientRequestId uuid olmalı", () => {
    expect(AnalysisInput.safeParse({ clientRequestId: "abc", geometry, image: jpegBytes.toString("base64") }).success).toBe(false);
  });
});

describe("GeometrySchema hybrid.v1 ek alanları (engine spec §1.2 C1, UI spec S7)", () => {
  const body = (g: unknown) => ({ clientRequestId: crypto.randomUUID(), geometry: g, image: jpegBytes.toString("base64") });
  const withMetrics = (m: Record<string, unknown>) => ({ ...geometry, metrics: { ...geometry.metrics, ...m } });
  const symmetry = { face: 0.012, eyes: 0.008, lower: 0.02 };

  it("eski geometri (yeni alanlar olmadan) geçerli", () => {
    const r = AnalysisInput.safeParse(body(geometry));
    expect(r.success).toBe(true);
    expect(r.success && r.data.geometry.metrics.ipdRatio).toBeUndefined();
  });

  it("yeni metrikler ve quality.relaxed geçerli ve korunur (şema bunları atmaz); null kabul edilir", () => {
    const g = { ...withMetrics({ ipdRatio: 0.46, eyeMouthRatio: 0.36, symmetry }), quality: { ...geometry.quality, relaxed: true } };
    const r = AnalysisInput.safeParse(body(g));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.geometry.metrics).toMatchObject({ ipdRatio: 0.46, eyeMouthRatio: 0.36, symmetry });
    expect(r.data.geometry.quality.relaxed).toBe(true);
    expect(r.data.geometry.version).toBe("geo-v1");
    expect(AnalysisInput.safeParse(body(withMetrics({ ipdRatio: null, eyeMouthRatio: null, symmetry: null }))).success).toBe(true);
  });

  it("aralık dışı değerler reddedilir", () => {
    const bad: Record<string, unknown>[] = [
      { ipdRatio: 0.1 },
      { ipdRatio: 0.9 },
      { eyeMouthRatio: 0.1 },
      { eyeMouthRatio: 0.75 },
      { symmetry: { ...symmetry, face: 0.31 } },
      { symmetry: { ...symmetry, eyes: -0.01 } },
      { symmetry: { face: 0.01, eyes: 0.01 } },
      { ipdRatio: "0.46" },
    ];
    for (const m of bad) expect(AnalysisInput.safeParse(body(withMetrics(m))).success, JSON.stringify(m)).toBe(false);
    expect(AnalysisInput.safeParse(body({ ...geometry, quality: { ...geometry.quality, relaxed: "yes" } })).success).toBe(false);
  });

  it("sürüm geo-v1 dışında olamaz; 478 noktalık dizi yeni alanlarla da kabul edilmez", () => {
    expect(AnalysisInput.safeParse(body({ ...geometry, version: "geo-v2" })).success).toBe(false);
    const points = new Array(478).fill(0).map(() => ({ x: 0.1, y: 0.2 }));
    const r = AnalysisInput.safeParse(body({ ...withMetrics({ symmetry }), landmarks: points }));
    // GeometrySchema katı değildir: bilinmeyen anahtar ayrıştırmada atılır, sunucuya hiç ulaşmaz.
    expect(r.success).toBe(true);
    if (r.success) expect(JSON.stringify(r.data.geometry)).not.toMatch(/landmarks|"x":/);
    expect(AnalysisInput.safeParse(body(withMetrics({ symmetry: points }))).success).toBe(false);
  });
});

describe("decodeJpeg (SPEC 16.4: boyut sınırı ve FF D8 imzası)", () => {
  it("JPEG imzası olmayan veri reddedilir", () => {
    expect(decodeJpeg(Buffer.from("PNG....", "utf8").toString("base64"))).toEqual({ error: "BAD_INPUT" });
    expect(decodeJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"))).toEqual({ error: "BAD_INPUT" });
  });
  it("600 KB üstü reddedilir", () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(600 * 1024, 0)]);
    expect(decodeJpeg(big.toString("base64"))).toEqual({ error: "IMAGE_TOO_LARGE" });
  });
  it("geçerli JPEG baytlarını döndürür", () => {
    const r = decodeJpeg(jpegBytes.toString("base64"));
    expect("bytes" in r && r.bytes.length).toBe(jpegBytes.length);
  });
});
