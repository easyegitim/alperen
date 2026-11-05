// SPEC 7.2 adım 4: sunucuya gidecek kopya — yüz + saç bölgesini içeren kare kırpım, 768 px, JPEG 0,85.
import type { Point } from "./types";

export const SERVER_CROP_SIZE = 768;
export const SERVER_JPEG_QUALITY = 0.85;
/** JSON gövdesinde base64 JPEG ≤ 600 KB (SPEC 14). */
export const SERVER_IMAGE_MAX_BYTES = 600 * 1024;

export type CropBox = { x: number; y: number; size: number };

/**
 * Yüz kutusundan kare kırpım: kenar = max(genişlik, yükseklik) × 1,9; merkez yüz merkezinin biraz üstü
 * (saç dahil olsun). Görüntü sınırlarına sığdırılır.
 */
export function computeCropBox(landmarks: Point[], width: number, height: number, scale = 1.9): CropBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of landmarks) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const faceW = maxX - minX;
  const faceH = maxY - minY;
  let size = Math.min(Math.max(faceW, faceH) * scale, width, height);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2 - faceH * 0.15;
  let x = cx - size / 2;
  let y = cy - size / 2;
  x = Math.max(0, Math.min(x, width - size));
  y = Math.max(0, Math.min(y, height - size));
  size = Math.floor(size);
  return { x: Math.floor(x), y: Math.floor(y), size };
}

/** Kırpımı 768×768 JPEG'e çevirir; boyut sınırını aşarsa kaliteyi düşürür. Yalnız istemci (OffscreenCanvas). */
export async function cropForServer(
  bitmap: ImageBitmap,
  landmarksPx: Point[],
  size = SERVER_CROP_SIZE,
): Promise<{ blob: Blob; box: CropBox }> {
  const box = computeCropBox(landmarksPx, bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.drawImage(bitmap, box.x, box.y, box.size, box.size, 0, 0, size, size);
  let quality = SERVER_JPEG_QUALITY;
  let blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  while (blob.size > SERVER_IMAGE_MAX_BYTES && quality > 0.5) {
    quality -= 0.1;
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  }
  return { blob, box };
}

/** Noktaları kırpım koordinatına taşır (deneme kompoziti için, SPEC 10.3). */
export function landmarksToCrop(landmarksPx: Point[], box: CropBox, size = SERVER_CROP_SIZE): Point[] {
  const k = size / box.size;
  return landmarksPx.map((p) => ({ x: (p.x - box.x) * k, y: (p.y - box.y) * k, z: p.z }));
}
