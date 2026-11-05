// react-native-mediapipe sonucunu web ile aynı FrameAnalysis'e çevirir (SPEC 7.3). Saf; birim testli.
import type { PixelStats } from "@/lib/face/pixelStats";
import type { BlendshapeScores, FrameAnalysis, Point } from "@/lib/face/types";

export type NativeLandmark = { x: number; y: number; z: number };
export type NativeCategory = { categoryName?: string; score: number };
export type NativeFaceResult = {
  faceLandmarks: NativeLandmark[][];
  faceBlendshapes: { categories: NativeCategory[] }[];
  facialTransformationMatrixes: { rows: number; columns: number; data: number[] }[];
};
export type NativeBundle = { results: NativeFaceResult[]; inputImageWidth: number; inputImageHeight: number };

export function pickBlendshapes(cats: NativeCategory[] | undefined): BlendshapeScores | null {
  if (!cats) return null;
  const get = (name: string) => cats.find((c) => c.categoryName === name)?.score ?? 0;
  return { eyeBlinkLeft: get("eyeBlinkLeft"), eyeBlinkRight: get("eyeBlinkRight"), mouthSmileLeft: get("mouthSmileLeft"), mouthSmileRight: get("mouthSmileRight"), jawOpen: get("jawOpen") };
}

/**
 * Tek yüz → landmark'lar (normalize), blendshape'ler ve 4×4 matris. Matris 16 sayı değilse null (poz kontrolü atlanır).
 * stats canlı karede null (piksel erişimi yok), çekilen karede Skia ile hesaplanır (SPEC-MOBILE M4).
 */
export function toFrameAnalysis(bundle: NativeBundle, timestamp: number, stats: PixelStats | null = null): FrameAnalysis {
  const res = bundle.results[0];
  const faces = res?.faceLandmarks.length ?? 0;
  const landmarks: Point[] | null = faces === 1 ? res.faceLandmarks[0].map((p) => ({ x: p.x, y: p.y, z: p.z })) : null;
  const m = faces === 1 ? res.facialTransformationMatrixes?.[0]?.data : undefined;
  return {
    width: bundle.inputImageWidth,
    height: bundle.inputImageHeight,
    faces,
    landmarks,
    blendshapes: faces === 1 ? pickBlendshapes(res.faceBlendshapes?.[0]?.categories) : null,
    matrix: faces === 1 && m && m.length === 16 ? [...m] : null,
    brightness: stats?.brightness ?? null,
    brightnessBalance: stats?.brightnessBalance ?? null,
    sharpness: stats?.sharpness ?? null,
    hairVisible: null, // segmenter M8'de
    timestamp,
  };
}
