import { describe, expect, it } from "vitest";
import { DEVICE_STEPS, deviceProgressValue, finishDeviceProgress, markDeviceStep, startDeviceProgress } from "@/lib/face/deviceProgress";
import { SHA256_HEX_RE, sha256Hex, sourceHashesFor } from "@/lib/face/hash";
import { FACE_OVAL, IDX, LANDMARK_COUNT } from "@/lib/face/indices";
import { PORTRAIT_KEY_LANDMARKS, portraitGeometry } from "@/lib/face/overlay";
import { GALLERY_QUALITY_CONFIG, HARD_ISSUES, QUALITY_CONFIG, checkQuality, lenientReview, sideViewReview } from "@/lib/face/quality";
import type { FrameAnalysis, Point } from "@/lib/face/types";

function fakeFace(w = 0.5, cx = 0.5, cy = 0.5): Point[] {
  const h = w * 1.3;
  return [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx, y: cy },
  ];
}
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const yawMatrix = (deg: number) => {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), 0, -Math.sin(r), 0, 0, 1, 0, 0, Math.sin(r), 0, Math.cos(r), 0, 0, 0, 0, 1];
};
function frame(over: Partial<FrameAnalysis> = {}): FrameAnalysis {
  return {
    width: 720, height: 960, faces: 1, landmarks: fakeFace(),
    blendshapes: { eyeBlinkLeft: 0.1, eyeBlinkRight: 0.1, mouthSmileLeft: 0.1, mouthSmileRight: 0.1, jawOpen: 0.05 },
    matrix: identity, brightness: 140, brightnessBalance: 10, sharpness: 120, hairVisible: true, timestamp: 0, ...over,
  };
}

describe("gevşek inceleme (KB R1-E12/E14: ret yerine uyarı)", () => {
  it("galeri yapılandırması: yaw 15 / pitch 15 / roll 10; ışık ve netlik gevşek; sıkı yapılandırma değişmedi", () => {
    expect(GALLERY_QUALITY_CONFIG.yawMaxDeg).toBe(15);
    expect(GALLERY_QUALITY_CONFIG.rollMaxDeg).toBe(10);
    expect(GALLERY_QUALITY_CONFIG.pitchMaxDeg).toBe(15);
    expect(GALLERY_QUALITY_CONFIG.sharpnessMin).toBe(40);
    expect(QUALITY_CONFIG.yawMaxDeg).toBe(8);
  });
  it("stüdyo portresi (12° yaw, hafif bulanık) engellenmez: uyarı listesine düşer", () => {
    const r = lenientReview(frame({ matrix: yawMatrix(12) }));
    expect(r.hard).toBeNull();
    expect(r.warnings).toEqual([]); // 12° galeri eşiğinin (15°) içinde
    const dark = lenientReview(frame({ brightness: 50, sharpness: 20, matrix: yawMatrix(20) }));
    expect(dark.hard).toBeNull();
    expect(dark.warnings).toEqual(["head_angle", "too_dark", "blurry"]);
  });
  it("yalnız yüz yok / çok yüz engeller", () => {
    expect(HARD_ISSUES).toEqual(["no_face", "multiple_faces"]);
    expect(lenientReview(frame({ faces: 0, landmarks: null })).hard).toBe("no_face");
    expect(lenientReview(frame({ faces: 2 })).hard).toBe("multiple_faces");
    expect(lenientReview(frame({ faces: 2 })).warnings).toEqual([]);
    // gülümseme, kapalı göz, uzak/yakın, kadraj: uyarı
    const r = lenientReview(frame({ landmarks: fakeFace(0.2, 0.8, 0.5), blendshapes: { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9, mouthSmileLeft: 0.9, mouthSmileRight: 0.9, jawOpen: 0.5 } }));
    expect(r.hard).toBeNull();
    expect(r.warnings).toEqual(["too_far", "off_center", "eyes_closed", "not_neutral"]);
  });
  it("yan görünümler: profil için yüz bulunamaması engel değil; birden çok yüz her görünümde engel", () => {
    expect(sideViewReview(frame({ faces: 0, landmarks: null }), { allowNoFace: true }).hard).toBeNull();
    expect(sideViewReview(frame({ faces: 0, landmarks: null }), { allowNoFace: false }).hard).toBe("no_face");
    expect(sideViewReview(frame({ faces: 2 }), { allowNoFace: true }).hard).toBe("multiple_faces");
    expect(sideViewReview(frame({ brightness: 20, sharpness: 1 }), { allowNoFace: false }).hard).toBeNull();
  });
  it("checkQuality sıkı davranışı aynen (canlı otomatik çekim için)", () => {
    expect(checkQuality(frame({ matrix: yawMatrix(10) })).issues).toContain("head_angle");
  });
});

describe("yuvarlak portre noktaları (KB P#6)", () => {
  it("30–70 anahtar nokta; yüz hattı dahil; tekrar yok", () => {
    expect(PORTRAIT_KEY_LANDMARKS.length).toBeGreaterThanOrEqual(30);
    expect(PORTRAIT_KEY_LANDMARKS.length).toBeLessThanOrEqual(70);
    expect(new Set(PORTRAIT_KEY_LANDMARKS).size).toBe(PORTRAIT_KEY_LANDMARKS.length);
    for (const i of FACE_OVAL) expect(PORTRAIT_KEY_LANDMARKS).toContain(i);
    expect(PORTRAIT_KEY_LANDMARKS).toContain(IDX.irisR);
  });
  it("kırpım karedir ve noktalar fotoğrafla aynı dönüşümden geçer", () => {
    const lm: Point[] = Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: 300 + 100 * Math.cos(i), y: 400 + 130 * Math.sin(i) }));
    const g = portraitGeometry(lm, 1000, 1000, 240);
    expect(g.crop.width).toBeCloseTo(g.crop.height, 5);
    expect(g.points.length).toBe(PORTRAIT_KEY_LANDMARKS.length);
    for (const [x, y] of g.points) {
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(x).toBeLessThanOrEqual(241);
      expect(y).toBeGreaterThanOrEqual(-1);
      expect(y).toBeLessThanOrEqual(241);
    }
    // İlk nokta = FACE_OVAL[0] = 10 → aynı dönüşüm
    const k = 240 / g.crop.width;
    expect(g.points[0][0]).toBeCloseTo((lm[10].x - g.crop.x) * k, 6);
    expect(g.oval?.length).toBe(FACE_OVAL.length + 1);
  });
  it("eksik nokta atlanır; boş liste tüm görüntü", () => {
    expect(portraitGeometry([], 100, 100, 50).points).toEqual([]);
  });
});

describe("set önbelleği hash'leri (KB Ç11)", () => {
  it("sha256Hex bilinen değeri verir", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("kamera çekimi (hash yok) varsa sourceHashes gönderilmez; hepsi galeriyse sırayla gider", () => {
    const h = "a".repeat(64);
    expect(sourceHashesFor([h, null])).toBeNull();
    expect(sourceHashesFor([])).toBeNull();
    expect(sourceHashesFor([h, "b".repeat(64)])).toEqual([h, "b".repeat(64)]);
    expect(sourceHashesFor(["xyz"])).toBeNull();
    expect(SHA256_HEX_RE.test(h)).toBe(true);
  });
});

describe("cihaz ilerleme adımları (KB P#5)", () => {
  it("adımlar gerçek işe bağlı; yalnız bitince 100", () => {
    let s = startDeviceProgress(0);
    expect(s.active).toBe("landmarks");
    expect(deviceProgressValue(s)).toBe(0);
    s = markDeviceStep(s, "landmarks");
    expect(s.active).toBe("ratios");
    s = markDeviceStep(markDeviceStep(markDeviceStep(s, "ratios"), "faceShape"), "views");
    expect(deviceProgressValue(s)).toBe(80);
    s = markDeviceStep(s, "save");
    expect(s.active).toBeNull();
    expect(deviceProgressValue(s)).toBe(95);
    expect(deviceProgressValue(finishDeviceProgress(s))).toBe(100);
    expect(DEVICE_STEPS).toEqual(["landmarks", "ratios", "faceShape", "views", "save"]);
  });
});
