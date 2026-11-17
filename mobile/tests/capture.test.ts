import { QUALITY_CONFIG, checkQuality } from "@/lib/face/quality";
import { analysisSize, base64Bytes, serverCrop } from "@/mobile/src/features/capture/cropMath";
import { toFrameAnalysis, type NativeBundle } from "@/mobile/src/features/capture/frame";
import { initialLive, shouldProcess, stepLive } from "@/mobile/src/features/capture/machine";

function bundle(faces: number, opts: { matrix?: number[]; smile?: number } = {}): NativeBundle {
  const lm = Array.from({ length: 478 }, (_, i) => ({ x: 0.3 + ((i % 20) / 20) * 0.4, y: 0.2 + (Math.floor(i / 20) / 24) * 0.55, z: 0 }));
  return {
    inputImageWidth: 720,
    inputImageHeight: 960,
    results: [
      {
        faceLandmarks: Array.from({ length: faces }, () => lm),
        faceBlendshapes: faces ? [{ categories: [{ categoryName: "eyeBlinkLeft", score: 0.1 }, { categoryName: "mouthSmileLeft", score: opts.smile ?? 0.05 }, { categoryName: "jawOpen", score: 0.02 }] }] : [],
        facialTransformationMatrixes: faces && opts.matrix ? [{ rows: 4, columns: 4, data: opts.matrix }] : [],
      },
    ],
  };
}
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe("native sonuç → FrameAnalysis (SPEC 7.3)", () => {
  it("tek yüz: landmark, blendshape ve matris; kalite kapısı geçer", () => {
    const f = toFrameAnalysis(bundle(1, { matrix: identity }), 1000, { brightness: 120, brightnessBalance: 5, sharpness: 200 });
    expect(f.faces).toBe(1);
    expect(f.landmarks).toHaveLength(478);
    expect(f.matrix).toHaveLength(16);
    expect(f.blendshapes?.mouthSmileLeft).toBe(0.05);
    expect(f.hairVisible).toBeNull();
    const q = checkQuality(f);
    expect(q.passed).toBe(true);
  });
  it("iki yüz veya yüz yok: landmark null ve kapı kapalı; bozuk matris null", () => {
    expect(checkQuality(toFrameAnalysis(bundle(2), 1)).issues[0]).toBe("multiple_faces");
    expect(checkQuality(toFrameAnalysis(bundle(0), 1)).issues[0]).toBe("no_face");
    expect(toFrameAnalysis(bundle(1, { matrix: [1, 2, 3] }), 1).matrix).toBeNull();
    expect(checkQuality(toFrameAnalysis(bundle(1, { matrix: identity, smile: 0.9 }), 1)).issues).toContain("not_neutral");
  });
});

describe("canlı döngü durum makinesi (SPEC 7.2)", () => {
  it("600 ms kararlı → geri sayım → 3 sn sonra çekim; bozulunca sıfırlanır", () => {
    let s = initialLive;
    let r = stepLive(s, true, 0);
    expect(r.state.stage).toBe("live");
    r = stepLive(r.state, true, QUALITY_CONFIG.stableMs);
    expect(r.state.stage).toBe("countdown");
    expect(r.countdown).toBe(3);
    r = stepLive(r.state, true, QUALITY_CONFIG.stableMs + 1500);
    expect(r.countdown).toBe(2);
    expect(r.capture).toBe(false);
    r = stepLive(r.state, true, QUALITY_CONFIG.stableMs + 3000);
    expect(r.capture).toBe(true);
    s = stepLive(initialLive, true, 0).state;
    expect(stepLive(s, false, 100)).toEqual({ state: initialLive, countdown: 0, capture: false });
    expect(shouldProcess(0, 50)).toBe(false);
    expect(shouldProcess(0, 100)).toBe(true);
  });
});

describe("kırpım ve boyut hesapları", () => {
  it("uzun kenar 1280'e iner, küçük görüntü büyümez; base64 bayt sayısı", () => {
    expect(analysisSize(4000, 3000)).toEqual({ width: 1280, height: 960 });
    expect(analysisSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(base64Bytes("AAAA")).toBe(3);
    expect(base64Bytes("AAA=")).toBe(2);
    const crop = serverCrop([{ x: 300, y: 300 }, { x: 500, y: 560 }], 1280, 960);
    expect(crop.size).toBe(768);
    expect(crop.box.size).toBeLessThanOrEqual(960);
  });
});
