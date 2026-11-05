import { TOTAL_IMAGE_MAX_BYTES, VIEW_BY_KEY, type ViewKey } from "@/lib/face/views";
import type { FrameAnalysis, GeometryResult } from "@/lib/face/types";
import { buildDeviceOnlyBody, buildRunBody, viewEncodeSpec, viewsLabel, type EncodedView } from "@/mobile/src/features/capture/payload";
import { decideFront, decideSide, sideLiveIssue } from "@/mobile/src/features/capture/quality";
import { addableViews, canStartDevice, classifyFrame, galleryTarget, hasProfile, nextStep, orderedViews, placeViews, relabelProfile, removeView, stepIndex, type CaptureSet } from "@/mobile/src/features/capture/views";

type Item = { view: ViewKey; id: number };
const item = (view: ViewKey, id = 1): Item => ({ view, id });

/** Y ekseni etrafında yaw (derece) için sütun-öncelikli 4×4 matris (lib/face/pose.ts eulerFromMatrix ile uyumlu). */
function yawMatrix(deg: number): number[] {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

function frame(opts: { faces?: number; matrix?: number[] | null; brightness?: number | null; sharpness?: number | null; landmarks?: boolean } = {}): FrameAnalysis {
  const faces = opts.faces ?? 1;
  const lm = Array.from({ length: 478 }, (_, i) => ({ x: 0.3 + ((i % 20) / 20) * 0.4, y: 0.2 + (Math.floor(i / 20) / 24) * 0.55, z: 0 }));
  return {
    width: 720,
    height: 960,
    faces,
    landmarks: faces === 1 && opts.landmarks !== false ? lm : null,
    blendshapes: faces === 1 ? { eyeBlinkLeft: 0.1, eyeBlinkRight: 0.1, mouthSmileLeft: 0.05, mouthSmileRight: 0.05, jawOpen: 0.02 } : null,
    matrix: faces === 1 ? (opts.matrix === undefined ? yawMatrix(0) : opts.matrix) : null,
    brightness: opts.brightness === undefined ? 120 : opts.brightness,
    brightnessBalance: 5,
    sharpness: opts.sharpness === undefined ? 200 : opts.sharpness,
    hairVisible: null,
    timestamp: 1,
  };
}

describe("çoklu açı akışı (KB P#4): ön → yan profil → isteğe bağlı → özet", () => {
  it("sıradaki adım ve zorunlu profil kuralı (iki profilden biri sayılır)", () => {
    let set: CaptureSet<Item> = {};
    expect(nextStep(set)).toEqual({ kind: "capture", view: "front", required: true });
    set = placeViews(set, [item("front")]).set;
    expect(nextStep(set)).toEqual({ kind: "capture", view: "profile_left", required: true });
    expect(hasProfile(set)).toBe(false);
    set = placeViews(set, [item("profile_right")]).set;
    expect(hasProfile(set)).toBe(true);
    expect(nextStep(set)).toEqual({ kind: "summary" });
    expect(orderedViews(set)).toEqual(["front", "profile_right"]);
    expect(addableViews(set)).toEqual(["profile_left", "left45", "right45", "hairline"]);
    set = removeView(set, "profile_right");
    expect(nextStep(set).kind).toBe("capture");
    expect(stepIndex({ kind: "capture", view: "front", required: true })).toEqual({ current: 1, total: 2 });
    expect(stepIndex({ kind: "capture", view: "profile_left", required: true })).toEqual({ current: 2, total: 2 });
    expect(stepIndex({ kind: "capture", view: "left45", required: false })).toBeNull();
  });

  it("aynı açı yeniden çekilince eskisi 'replaced' listesine düşer (geçici dosya silinsin)", () => {
    const first = item("front", 1);
    const { set, replaced } = placeViews({ front: first }, [item("front", 2), item("hairline", 3)]);
    expect(replaced).toEqual([first]);
    expect(set.front?.id).toBe(2);
    expect(orderedViews(set)).toEqual(["front", "hairline"]);
  });

  it("yaw sınıflaması: 0° ön, 40° yarım profil, 75° profil; işaret sol/sağ; matris yoksa 'invalid'", () => {
    expect(classifyFrame(frame({ matrix: yawMatrix(0) }))).toEqual({ view: "front" });
    expect(classifyFrame(frame({ matrix: yawMatrix(40) }))).toEqual({ view: "left45" });
    expect(classifyFrame(frame({ matrix: yawMatrix(-40) }))).toEqual({ view: "right45" });
    expect(classifyFrame(frame({ matrix: yawMatrix(75) }))).toEqual({ view: "profile_left" });
    expect(classifyFrame(frame({ matrix: yawMatrix(-80) }))).toEqual({ view: "profile_right" });
    expect(classifyFrame(frame({ matrix: yawMatrix(20) }))).toEqual({ view: null, reason: "between" });
    expect(classifyFrame(frame({ matrix: null }))).toEqual({ view: null, reason: "invalid" });
    expect(classifyFrame(frame({ faces: 2 }))).toEqual({ view: null, reason: "invalid" });
    // profil adımında yanak yaw'dan etiketlenir; doğrulama değildir
    expect(relabelProfile("profile_left", { view: "profile_right" })).toBe("profile_right");
    expect(relabelProfile("profile_left", { view: null, reason: "invalid" })).toBe("profile_left");
    expect(relabelProfile("hairline", { view: "profile_right" })).toBe("hairline");
  });

  it("galeri çoklu seçim: yaw'a göre yerleşir, dolu açı bu adıma düşer, o da doluysa atlanır", () => {
    const taken = new Set<ViewKey>();
    expect(galleryTarget({ view: "profile_left" }, taken, "front")).toBe("profile_left");
    taken.add("profile_left");
    expect(galleryTarget({ view: "profile_left" }, taken, "front")).toBe("front");
    expect(galleryTarget({ view: null, reason: "between" }, taken, "front")).toBe("front");
    taken.add("front");
    expect(galleryTarget({ view: null, reason: "invalid" }, taken, "front")).toBeNull();
  });

  it("başlat koşulu: ön + geometri + profil; kota hatasında pasif", () => {
    const set: CaptureSet<Item> = { front: item("front"), profile_left: item("profile_left") };
    expect(canStartDevice(set, true)).toBe(true);
    expect(canStartDevice(set, false)).toBe(false);
    expect(canStartDevice({ front: item("front") }, true)).toBe(false);
    expect(canStartDevice(set, true, "QUOTA_EXCEEDED")).toBe(false);
    expect(canStartDevice(set, true, "NETWORK")).toBe(true);
  });
});

describe("gevşek kalite kararları (KB R1-E12/E14: ret yerine uyarı)", () => {
  it("ön: iyi kare uyarısız; karanlık/bulanık kare uyarı + pop-up; yüz yok / çok yüz engel", () => {
    const good = decideFront(frame());
    expect(good).toMatchObject({ ok: true, hard: null, warnings: [], prompt: false, relaxed: false });
    const dark = decideFront(frame({ brightness: 40, sharpness: 20 }));
    expect(dark.ok).toBe(true);
    expect(dark.prompt).toBe(true);
    expect(dark.relaxed).toBe(true);
    expect(dark.warnings).toEqual(expect.arrayContaining(["too_dark", "blurry"]));
    expect(decideFront(frame({ faces: 0 }))).toMatchObject({ ok: false, hard: "no_face", prompt: false });
    expect(decideFront(frame({ faces: 2 }))).toMatchObject({ ok: false, hard: "multiple_faces", warnings: [] });
  });
  it("ön: elle çekimde gevşek elle eşiği geçen kare uyarısız ama relaxed", () => {
    const soft = decideFront(frame({ brightness: 70 }), { manual: true });
    expect(soft.warnings).toEqual([]);
    expect(soft.prompt).toBe(false);
    expect(soft.relaxed).toBe(true);
  });
  it("yan açılar: profilde yüz yok engel değil, 45°/saç çizgisinde engel; çok yüz her yerde engel", () => {
    expect(decideSide(frame({ faces: 0 }), "profile_left")).toEqual({ ok: true, hard: null });
    expect(decideSide(frame({ faces: 0 }), "left45")).toEqual({ ok: false, hard: "no_face" });
    expect(decideSide(frame({ faces: 2 }), "profile_right")).toEqual({ ok: false, hard: "multiple_faces" });
    expect(sideLiveIssue({ faces: 2 })).toBe("multiple_faces");
    expect(sideLiveIssue({ faces: 0 })).toBeNull();
  });
});

describe("gövde kuralları ve gizlilik (CONTRACTS_V2 §2.2)", () => {
  const b64 = (bytes: number) => "/9j/" + "A".repeat(Math.ceil((bytes * 4) / 3) - 4);
  const enc = (view: ViewKey, bytes: number, sourceHash: string | null = null): EncodedView => ({ view, base64: b64(bytes), bytes, sourceHash });
  const geometry = { version: "geo-v1", quality: { yaw: 0, pitch: 0, roll: 0, brightness: 120, sharpness: 200, passed: true } } as unknown as GeometryResult; // test çifti: yalnız quality alanı kullanılır

  it("görünüm başına kırpım/kalite/tavan VIEWS ile aynı", () => {
    expect(viewEncodeSpec("front")).toEqual({ size: 768, quality: 0.85, maxBytes: 600 * 1024 });
    expect(viewEncodeSpec("profile_left")).toEqual({ size: 640, quality: 0.8, maxBytes: 400 * 1024 });
    expect(viewEncodeSpec("hairline").size).toBe(VIEW_BY_KEY.hairline.cropPx);
  });

  it("device_only gövdesinde görsel alanı yok; relaxed yalnız geometry.quality'ye işlenir; hash yalnız tam galeri setinde", () => {
    const body = buildDeviceOnlyBody({ clientRequestId: "c1", geometry, relaxed: true, hashes: [null] });
    expect(Object.keys(body).sort()).toEqual(["clientRequestId", "geometry"]);
    expect(body.geometry.quality.relaxed).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/image|\/9j\//);
    const hashed = buildDeviceOnlyBody({ clientRequestId: "c1", geometry, relaxed: false, hashes: ["a".repeat(64), "b".repeat(64)] });
    expect(hashed.sourceHashes).toHaveLength(2);
    expect(hashed.geometry.quality.relaxed).toBeUndefined();
    expect(buildDeviceOnlyBody({ clientRequestId: "c1", geometry, relaxed: false, hashes: ["a".repeat(64), null] }).sourceHashes).toBeUndefined();
  });

  it("run gövdesi: ön + ≥1 profil zorunlu; yalnız izinli görünümler; tekrar yok", () => {
    expect(buildRunBody([enc("profile_left", 1000)])).toEqual({ ok: false, reason: "front_missing" });
    expect(buildRunBody([enc("front", 1000)])).toEqual({ ok: false, reason: "profile_missing" });
    expect(buildRunBody([enc("front", 1000), enc("profile_left", 1000), enc("profile_left", 1000)])).toEqual({ ok: false, reason: "duplicate_view" });
    expect(buildRunBody([enc("front", 1000), enc("profile_left", 1000), enc("selfie" as ViewKey, 1000)])).toEqual({ ok: false, reason: "unknown_view" });
    const ok = buildRunBody([enc("front", 1000), enc("profile_right", 900), enc("hairline", 800)]);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.views).toEqual(["front", "profile_right", "hairline"]);
      expect(ok.body.images.map((i) => i.view)).toEqual(["front", "profile_right", "hairline"]);
      expect(ok.body.sourceHashes).toBeUndefined();
      expect(ok.body.images.every((i) => i.data.startsWith("/9j/"))).toBe(true);
    }
    expect(viewsLabel(["front", "profile_right"])).toEqual({ views: "front,profile_right", count: 2 });
  });

  it("bayt tavanları: ön 600 KB, yan 400 KB, toplam 3000 KB", () => {
    expect(buildRunBody([enc("front", 600 * 1024 + 1), enc("profile_left", 1000)])).toEqual({ ok: false, reason: "image_too_large", view: "front" });
    expect(buildRunBody([enc("front", 1000), enc("left45", 400 * 1024 + 1), enc("profile_left", 1000)])).toEqual({ ok: false, reason: "image_too_large", view: "left45" });
    const full = [enc("front", 600 * 1024), enc("profile_left", 400 * 1024), enc("profile_right", 400 * 1024), enc("left45", 400 * 1024), enc("right45", 400 * 1024), enc("hairline", 400 * 1024)];
    // Altı görünüm tavanda tam olarak toplam tavana eşittir (600 + 5 × 400 KB): sınır dahil kabul edilir.
    expect(full.reduce((s, e) => s + e.bytes, 0)).toBe(TOTAL_IMAGE_MAX_BYTES);
    expect(buildRunBody(full).ok).toBe(true);
    expect(buildRunBody(full.slice(0, 2)).ok).toBe(true);
  });

  it("sourceHashes yalnız bütün görseller galeriden geldiyse, images ile aynı sırada", () => {
    const h = (c: string) => c.repeat(64);
    const r = buildRunBody([enc("front", 100, h("a")), enc("profile_left", 100, h("b"))]);
    expect(r.ok && r.body.sourceHashes).toEqual([h("a"), h("b")]);
    const mixed = buildRunBody([enc("front", 100, h("a")), enc("profile_left", 100, null)]);
    expect(mixed.ok && mixed.body.sourceHashes).toBeUndefined();
  });
});
