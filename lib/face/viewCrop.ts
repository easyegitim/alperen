// Yan görünümler (profil, 45°, saç çizgisi) için sunucu kırpımı (CONTRACTS_V2 §2.1: 640 px, JPEG 0,80, ≤ 400 KB).
// Yüz ağı varsa yüz kutusundan (crop.ts kuralı), yoksa (90° profilde ağ güvenilmez) merkez kare. Yalnız istemci
// (OffscreenCanvas); görüntü yalnız POST /api/analyses gövdesine girer.
import { computeCropBox, type CropBox } from "./crop";
import type { Point } from "./types";
import { VIEW_BY_KEY, type ViewKey } from "./views";

export function centerSquareBox(width: number, height: number): CropBox {
  const size = Math.floor(Math.min(width, height));
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size };
}

export async function cropViewForServer(bitmap: ImageBitmap, landmarksPx: Point[] | null, view: ViewKey): Promise<Blob> {
  const spec = VIEW_BY_KEY[view];
  const box = landmarksPx && landmarksPx.length > 0 ? computeCropBox(landmarksPx, bitmap.width, bitmap.height) : centerSquareBox(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(spec.cropPx, spec.cropPx);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.drawImage(bitmap, box.x, box.y, box.size, box.size, 0, 0, spec.cropPx, spec.cropPx);
  let quality = spec.jpegQuality;
  let blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  while (blob.size > spec.maxBytes && quality > 0.45) {
    quality -= 0.1;
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  }
  return blob;
}
