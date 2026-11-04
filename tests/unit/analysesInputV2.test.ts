import { describe, expect, it } from "vitest";
import { AnalysisInputRaw, AnalysisInputSchema, base64Bytes, decodeImages, normalizeAnalysisInput } from "@/lib/api/analysesInput";
import { FRONT_MAX_BYTES, SIDE_MAX_BYTES, TOTAL_IMAGE_MAX_BYTES } from "@/lib/face/views";

const jpeg = (bytes: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes - 4, 1)]).toString("base64");
const small = jpeg(300);
const geometry = {
  version: "geo-v1",
  quality: { yaw: 1, pitch: 2, roll: 0, brightness: 120, sharpness: 90, passed: true },
  metrics: { lengthRatio: 1.4, jawRatio: 0.84, foreheadRatio: 0.9, fwhr: 1.9, canthalTiltDeg: 3, lowerToMiddle: 1.2, thirds: { upper: null, middle: 0.45, lower: 0.55 }, hairlineFound: false },
  faceShape: { primary: "oval", confidence: 0.8 },
  capturedAt: "2026-10-09T10:00:00Z",
};
const hash = (c: string) => c.repeat(64);
const body = (extra: Record<string, unknown>) => ({ clientRequestId: crypto.randomUUID(), geometry, ...extra });

describe("AnalysisInputRaw v2 (CONTRACTS_V2 §2.1)", () => {
  it("full: ön + en az bir profil zorunlu; 45° ve saç çizgisi isteğe bağlı", () => {
    expect(AnalysisInputRaw.safeParse(body({ mode: "full", images: [{ view: "front", data: small }] })).success).toBe(false);
    expect(AnalysisInputRaw.safeParse(body({ mode: "full", images: [{ view: "front", data: small }, { view: "profile_left", data: small }] })).success).toBe(true);
    const all = ["front", "profile_left", "profile_right", "left45", "right45", "hairline"].map((view) => ({ view, data: small }));
    expect(AnalysisInputRaw.safeParse(body({ mode: "full", images: all })).success).toBe(true);
    // mode verilmezse images varsa full sayılır
    expect(AnalysisInputRaw.safeParse(body({ images: [{ view: "front", data: small }] })).success).toBe(false);
  });

  it("device_only: görsel gönderilmez; sourceHashes tek başına gönderilebilir", () => {
    expect(AnalysisInputRaw.safeParse(body({ mode: "device_only" })).success).toBe(true);
    expect(AnalysisInputRaw.safeParse(body({ mode: "device_only", images: [] })).success).toBe(true);
    expect(AnalysisInputRaw.safeParse(body({ mode: "device_only", sourceHashes: [hash("a"), hash("b")] })).success).toBe(true);
    expect(AnalysisInputRaw.safeParse(body({ mode: "device_only", images: [{ view: "front", data: small }] })).success).toBe(false);
    expect(AnalysisInputRaw.safeParse(body({ mode: "device_only", image: small })).success).toBe(false);
  });

  it("tekrar eden, bilinmeyen görünüm ve image+images birlikte reddedilir", () => {
    expect(AnalysisInputRaw.safeParse(body({ mode: "full", images: [{ view: "front", data: small }, { view: "front", data: small }, { view: "profile_left", data: small }] })).success).toBe(false);
    expect(AnalysisInputRaw.safeParse(body({ mode: "full", images: [{ view: "front", data: small }, { view: "top", data: small }] })).success).toBe(false);
    expect(AnalysisInputRaw.safeParse(body({ image: small, images: [{ view: "front", data: small }] })).success).toBe(false);
    expect(AnalysisInputRaw.safeParse(body({})).success).toBe(false);
  });

  it("görünüm başına bayt tavanı: ön 600 KB, diğerleri 400 KB; toplam tavan", () => {
    const sideOk = jpeg(SIDE_MAX_BYTES);
    const sideBig = jpeg(SIDE_MAX_BYTES + 3);
    const frontBig = jpeg(FRONT_MAX_BYTES + 3);
    expect(base64Bytes(sideOk)).toBe(SIDE_MAX_BYTES);
    expect(AnalysisInputRaw.safeParse(body({ mode: "full", images: [{ view: "front", data: small }, { view: "profile_left", data: sideOk }] })).success).toBe(true);
    const r = AnalysisInputRaw.safeParse(body({ mode: "full", images: [{ view: "front", data: small }, { view: "profile_left", data: sideBig }] }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("image_too_large_profile_left");
    expect(AnalysisInputRaw.safeParse(body({ mode: "full", images: [{ view: "front", data: frontBig }, { view: "profile_left", data: small }] })).success).toBe(false);
    // ön 600 KB'ye kadar serbest, yan 600 KB olamaz
    expect(AnalysisInputRaw.safeParse(body({ mode: "full", images: [{ view: "front", data: jpeg(FRONT_MAX_BYTES) }, { view: "profile_left", data: small }] })).success).toBe(true);
    expect(AnalysisInputRaw.safeParse(body({ mode: "full", images: [{ view: "front", data: small }, { view: "profile_left", data: jpeg(FRONT_MAX_BYTES) }] })).success).toBe(false);
    // toplam: 600 + 5 × 400 KB sınırın içinde; her görünüm tavanda olunca toplam tam sınırdır
    expect(FRONT_MAX_BYTES + 5 * SIDE_MAX_BYTES).toBe(TOTAL_IMAGE_MAX_BYTES);
  });

  it("sourceHashes: sha256 hex; images varsa aynı sayıda", () => {
    const imgs = [{ view: "front", data: small }, { view: "profile_right", data: small }];
    expect(AnalysisInputRaw.safeParse(body({ mode: "full", images: imgs, sourceHashes: [hash("a"), hash("b")] })).success).toBe(true);
    expect(AnalysisInputRaw.safeParse(body({ mode: "full", images: imgs, sourceHashes: [hash("a")] })).success).toBe(false);
    expect(AnalysisInputRaw.safeParse(body({ mode: "full", images: imgs, sourceHashes: ["ABC", hash("b")] })).success).toBe(false);
    expect(AnalysisInputRaw.safeParse(body({ mode: "full", images: imgs, sourceHashes: [] })).success).toBe(false);
  });

  it("478 noktalık dizi hiçbir biçimde geçmez", () => {
    const points = new Array(478).fill(0).map(() => ({ x: 0.1, y: 0.2 }));
    const r = AnalysisInputRaw.safeParse(body({ mode: "full", images: [{ view: "front", data: small, landmarks: points }, { view: "profile_left", data: small }], landmarks: points }));
    expect(r.success).toBe(true);
    if (r.success) expect(JSON.stringify(r.data)).not.toMatch(/landmarks|"x":/);
  });
});

describe("normalizeAnalysisInput (CONTRACTS_V2 §2.2)", () => {
  it("eski { image } → images [front], mode full, legacy true; tek hash korunur", () => {
    const n = normalizeAnalysisInput(AnalysisInputRaw.parse(body({ image: small, sourceHashes: [hash("a")] })));
    expect(n).toMatchObject({ mode: "full", legacy: true, images: [{ view: "front", data: small }], sourceHashes: [hash("a")] });
    expect(normalizeAnalysisInput(AnalysisInputRaw.parse(body({ image: small }))).sourceHashes).toBeNull();
  });
  it("v2 full: sıra korunur, legacy false; device_only: images boş", () => {
    const imgs = [{ view: "profile_left", data: small }, { view: "front", data: small }];
    const n = AnalysisInputSchema.parse(body({ mode: "full", images: imgs }));
    expect(n.images.map((i) => i.view)).toEqual(["profile_left", "front"]);
    expect(n).toMatchObject({ mode: "full", legacy: false, sourceHashes: null });
    const d = AnalysisInputSchema.parse(body({ mode: "device_only", sourceHashes: [hash("c")] }));
    expect(d).toMatchObject({ mode: "device_only", images: [], legacy: false, sourceHashes: [hash("c")] });
  });
});

describe("decodeImages", () => {
  it("her görünümü çözer; JPEG olmayan görünüm adıyla reddedilir; yan tavanı aşan görsel reddedilir", () => {
    const ok = decodeImages([{ view: "front", data: small }, { view: "left45", data: small }]);
    expect("images" in ok && Object.keys(ok.images).sort()).toEqual(["front", "left45"]);
    expect("images" in ok && ok.totalBytes).toBe(600);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...new Array(200).fill(0)]).toString("base64");
    expect(decodeImages([{ view: "front", data: small }, { view: "right45", data: png }])).toEqual({ error: "BAD_INPUT", view: "right45" });
    expect(decodeImages([{ view: "front", data: small }, { view: "hairline", data: jpeg(SIDE_MAX_BYTES + 1) }])).toEqual({ error: "IMAGE_TOO_LARGE", view: "hairline" });
  });
});
