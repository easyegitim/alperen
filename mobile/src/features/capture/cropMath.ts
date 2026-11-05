// Sunucu kırpımı ve analiz boyutu için saf hesaplar (lib/face/crop.ts ve preprocess.ts sabitleriyle).
import { computeCropBox, SERVER_CROP_SIZE, SERVER_IMAGE_MAX_BYTES, SERVER_JPEG_QUALITY, type CropBox } from "@/lib/face/crop";
import type { Point } from "@/lib/face/types";

export const ANALYSIS_LONG_SIDE = 1280;

/** Uzun kenar ≤ 1280 olacak hedef boyut; küçük görüntü büyütülmez. */
export function analysisSize(width: number, height: number, longSide = ANALYSIS_LONG_SIDE): { width: number; height: number } {
  const k = Math.min(1, longSide / Math.max(width, height));
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

export function serverCrop(landmarksPx: Point[], width: number, height: number): { box: CropBox; size: number; quality: number; maxBytes: number } {
  return { box: computeCropBox(landmarksPx, width, height), size: SERVER_CROP_SIZE, quality: SERVER_JPEG_QUALITY, maxBytes: SERVER_IMAGE_MAX_BYTES };
}

/** base64 uzunluğundan bayt sayısı (dolgu dahil). */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}
