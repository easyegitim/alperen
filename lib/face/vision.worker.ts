// Web Worker: Face Landmarker + Image Segmenter (SPEC 7.1). Görüntü ve noktalar hiçbir yere gönderilmez/loglanmaz.
import { isModuleWorkerFromProbe } from "./workerEnv";
import { FaceLandmarker, FilesetResolver, ImageSegmenter, type FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import type { Protect } from "@/content/types";
import { CompositeError, compositeTryon, geometryDrift, type CompositeFailReason, type DriftPolicy } from "@/lib/tryon/composite";
import { faceBoxToPixels, pixelStatsFromRgba } from "./pixelStats";
import { SEG_CLASS, type BlendshapeScores, type FrameAnalysis, type Point, type SegmentationResult } from "./types";

export type WorkerRequest =
  | { type: "init"; id: number; basePath: string }
  | { type: "detectVideo"; id: number; bitmap: ImageBitmap; timestamp: number }
  | { type: "detectImage"; id: number; bitmap: ImageBitmap }
  | { type: "segment"; id: number; bitmap: ImageBitmap }
  | { type: "tryon"; id: number; c: ImageBitmap; g: ImageBitmap; landmarksC: Point[]; protect: Protect; policy: DriftPolicy; glowUp?: boolean }
  | { type: "close"; id: number };

export type TryonWorkerResult =
  | { ok: true; image: ImageBitmap; residual: number; drift: { length: number; jaw: number }; toneAdjusted: boolean }
  | { ok: false; reason: CompositeFailReason | "geometry_drift" };

export type InitResult = { delegate: "GPU" | "CPU" };

export type WorkerResponse =
  | { id: number; ok: true; result: InitResult | FrameAnalysis | SegmentationResult | TryonWorkerResult | null }
  | { id: number; ok: false; error: string };

let landmarker: FaceLandmarker | null = null;
let landmarkerMode: "VIDEO" | "IMAGE" = "VIDEO";
let segmenter: ImageSegmenter | null = null;
let segmenterInit: Promise<void> | null = null;
let delegate: "GPU" | "CPU" = "GPU";
let frameCounter = 0;
let lastHairVisible: boolean | null = null;
let lastVideoTimestamp = -1;

const statsCanvas = new OffscreenCanvas(256, 256);

/** Yükleyici (importScripts / dynamic import) worker türüne göre seçilir; probe CSP'ye uyumludur (workerEnv.ts). */
function isModuleWorker(): boolean {
  const scope = globalThis as { importScripts?: (...urls: string[]) => void };
  return isModuleWorkerFromProbe(scope.importScripts ? (...u: string[]) => scope.importScripts!(...u) : undefined);
}

async function init(basePath: string): Promise<InitResult> {
  const vision = await FilesetResolver.forVisionTasks(`${basePath}/wasm`, isModuleWorker());
  const modelAssetPath = `${basePath}/face_landmarker.task`;
  const common = {
    runningMode: "VIDEO" as const,
    numFaces: 2,
    minFaceDetectionConfidence: 0.6,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  };
  try {
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: "GPU" },
      canvas: new OffscreenCanvas(1, 1),
      ...common,
    });
    delegate = "GPU";
  } catch {
    landmarker = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath, delegate: "CPU" }, ...common });
    delegate = "CPU";
  }
  landmarkerMode = "VIDEO";

  // Segmenter arka planda (16 MB); hazır olana kadar hairVisible = null.
  segmenterInit = (async () => {
    const segPath = `${basePath}/selfie_multiclass_256x256.tflite`;
    try {
      segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: segPath, delegate },
        ...(delegate === "GPU" ? { canvas: new OffscreenCanvas(1, 1) } : {}),
        runningMode: "IMAGE",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
    } catch {
      segmenter = null;
    }
  })();

  return { delegate };
}

async function ensureMode(mode: "VIDEO" | "IMAGE") {
  if (!landmarker) throw new Error("not_initialized");
  if (landmarkerMode !== mode) {
    await landmarker.setOptions({ runningMode: mode });
    landmarkerMode = mode;
    lastVideoTimestamp = -1;
  }
}

function pickBlendshapes(res: FaceLandmarkerResult): BlendshapeScores | null {
  const cats = res.faceBlendshapes?.[0]?.categories;
  if (!cats) return null;
  const get = (name: string) => cats.find((c) => c.categoryName === name)?.score ?? 0;
  return {
    eyeBlinkLeft: get("eyeBlinkLeft"),
    eyeBlinkRight: get("eyeBlinkRight"),
    mouthSmileLeft: get("mouthSmileLeft"),
    mouthSmileRight: get("mouthSmileRight"),
    jawOpen: get("jawOpen"),
  };
}

/** Yüz kutusu (normalize). */
function box(landmarks: Point[]) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Parlaklık, sol/sağ yanak dengesi ve Laplace varyansı; 256 px'e küçültülmüş kopyada hesaplanır (lib/face/pixelStats.ts). */
function pixelStats(bitmap: ImageBitmap, landmarks: Point[]) {
  const ctx = statsCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { brightness: null, brightnessBalance: null, sharpness: null };
  const S = 256;
  ctx.drawImage(bitmap, 0, 0, S, S);
  const { x0, y0, w, h } = faceBoxToPixels(box(landmarks), S);
  if (w < 8 || h < 8) return { brightness: null, brightnessBalance: null, sharpness: null };
  return pixelStatsFromRgba(ctx.getImageData(x0, y0, w, h).data, w, h);
}

/** Segmenter saç sınıfı yüz kutusunun hemen üstünde var mı? */
function hairAboveFace(bitmap: ImageBitmap, landmarks: Point[]): boolean | null {
  if (!segmenter) return null;
  const res = segmenter.segment(bitmap);
  try {
    const mask = res.categoryMask;
    if (!mask) return null;
    const data = mask.getAsUint8Array();
    const mw = mask.width, mh = mask.height;
    const b = box(landmarks);
    const faceH = b.maxY - b.minY;
    const y0 = Math.max(0, Math.floor((b.minY - faceH * 0.35) * mh)), y1 = Math.max(0, Math.floor(b.minY * mh));
    const x0 = Math.max(0, Math.floor(b.minX * mw)), x1 = Math.min(mw, Math.ceil(b.maxX * mw));
    let hair = 0, total = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { total++; if (data[y * mw + x] === SEG_CLASS.hair) hair++; }
    return total > 0 ? hair / total >= 0.05 : null;
  } finally {
    res.close();
  }
}

function toAnalysis(res: FaceLandmarkerResult, bitmap: ImageBitmap, timestamp: number, withHair: boolean): FrameAnalysis {
  const faces = res.faceLandmarks.length;
  const landmarks = faces === 1 ? res.faceLandmarks[0].map((p) => ({ x: p.x, y: p.y, z: p.z })) : null;
  const matrixData = res.facialTransformationMatrixes?.[0]?.data;
  const stats = landmarks ? pixelStats(bitmap, landmarks) : { brightness: null, brightnessBalance: null, sharpness: null };
  let hairVisible: boolean | null = lastHairVisible;
  if (landmarks && withHair) {
    hairVisible = hairAboveFace(bitmap, landmarks);
    lastHairVisible = hairVisible;
  }
  return {
    width: bitmap.width,
    height: bitmap.height,
    faces,
    landmarks,
    blendshapes: faces === 1 ? pickBlendshapes(res) : null,
    matrix: faces === 1 && matrixData ? Array.from(matrixData) : null,
    ...stats,
    hairVisible: landmarks ? hairVisible : null,
    timestamp,
  };
}

async function detectVideo(bitmap: ImageBitmap, timestamp: number): Promise<FrameAnalysis> {
  await ensureMode("VIDEO");
  // MediaPipe zaman damgasının kesin artması gerekir.
  const ts = timestamp <= lastVideoTimestamp ? lastVideoTimestamp + 1 : timestamp;
  lastVideoTimestamp = ts;
  const res = landmarker!.detectForVideo(bitmap, ts);
  frameCounter++;
  return toAnalysis(res, bitmap, ts, frameCounter % 5 === 0);
}

async function detectImage(bitmap: ImageBitmap): Promise<FrameAnalysis> {
  await ensureMode("IMAGE");
  if (segmenterInit) await segmenterInit;
  const res = landmarker!.detect(bitmap);
  return toAnalysis(res, bitmap, performance.now(), true);
}

/** SPEC 10.4–10.5: G'de yüz bul → hizala → kompozit → kompozitte tekrar yüz bul → geometri sapması. Görseller bellekte kalır. */
async function tryon(c: ImageBitmap, g: ImageBitmap, landmarksC: Point[], protect: Protect, policy: DriftPolicy, glowUp = false): Promise<TryonWorkerResult> {
  await ensureMode("IMAGE");
  const resG = landmarker!.detect(g);
  if (resG.faceLandmarks.length !== 1) return { ok: false, reason: "no_face_in_output" };
  const landmarksG = resG.faceLandmarks[0].map((p) => ({ x: p.x * g.width, y: p.y * g.height }));
  let comp;
  try {
    comp = await compositeTryon({ c, g, landmarksC, landmarksG, protect, glowUp });
  } catch (e) {
    return { ok: false, reason: e instanceof CompositeError ? e.reason : "canvas" };
  }
  const resOut = landmarker!.detect(comp.image);
  if (resOut.faceLandmarks.length !== 1) {
    comp.image.close();
    return { ok: false, reason: "no_face_in_output" };
  }
  const landmarksOut = resOut.faceLandmarks[0].map((p) => ({ x: p.x * comp.image.width, y: p.y * comp.image.height }));
  const drift = geometryDrift(landmarksC, landmarksOut, policy);
  if (!drift.ok) {
    comp.image.close();
    return { ok: false, reason: "geometry_drift" };
  }
  return { ok: true, image: comp.image, residual: comp.residual, drift: { length: drift.length, jaw: drift.jaw }, toneAdjusted: comp.toneAdjusted };
}

async function segment(bitmap: ImageBitmap): Promise<SegmentationResult | null> {
  if (segmenterInit) await segmenterInit;
  if (!segmenter) return null;
  const res = segmenter.segment(bitmap);
  try {
    const mask = res.categoryMask;
    if (!mask) return null;
    return { width: mask.width, height: mask.height, mask: new Uint8Array(mask.getAsUint8Array()) };
  } finally {
    res.close();
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  const reply = (r: WorkerResponse, transfer: Transferable[] = []) => postMessage(r, { transfer });
  try {
    switch (msg.type) {
      case "init":
        reply({ id: msg.id, ok: true, result: await init(msg.basePath) });
        break;
      case "detectVideo":
        try {
          reply({ id: msg.id, ok: true, result: await detectVideo(msg.bitmap, msg.timestamp) });
        } finally {
          msg.bitmap.close();
        }
        break;
      case "detectImage":
        try {
          reply({ id: msg.id, ok: true, result: await detectImage(msg.bitmap) });
        } finally {
          msg.bitmap.close();
        }
        break;
      case "segment":
        try {
          const r = await segment(msg.bitmap);
          reply({ id: msg.id, ok: true, result: r }, r ? [r.mask.buffer] : []);
        } finally {
          msg.bitmap.close();
        }
        break;
      case "tryon":
        try {
          const r = await tryon(msg.c, msg.g, msg.landmarksC, msg.protect, msg.policy, msg.glowUp);
          reply({ id: msg.id, ok: true, result: r }, r.ok ? [r.image] : []);
        } finally {
          msg.c.close();
          msg.g.close();
        }
        break;
      case "close":
        landmarker?.close();
        segmenter?.close();
        landmarker = null;
        segmenter = null;
        reply({ id: msg.id, ok: true, result: null });
        break;
    }
  } catch (err) {
    reply({ id: msg.id, ok: false, error: err instanceof Error ? err.message : "worker_error" });
  }
};
