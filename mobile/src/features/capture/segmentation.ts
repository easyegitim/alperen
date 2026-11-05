// Segmenter maskesi yardımcıları (SPEC-MOBILE M8). Saf; birim testli. Native modül base64 kategori maskesi döner.
import type { Point, SegmentationResult } from "@/lib/face/types";
import { SEG_CLASS } from "@/lib/face/types";

/** Model dosyası adı; plugins/withMediapipeModels.js ve scripts/setup-models.mjs ile aynı. */
export const SEGMENTER_MODEL = "selfie_multiclass_256x256.tflite";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Uint8Array(256).fill(255);
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i;

/** Ortamdan bağımsız base64 çözücü (Hermes/Jest). Geçersiz karakterde null. */
export function decodeBase64(s: string): Uint8Array | null {
  const clean = s.replace(/[\r\n=]+$/g, "").replace(/\s+/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = LOOKUP[clean.charCodeAt(i)];
    if (v === 255) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Native sonucu SegmentationResult'a çevirir; boyut/uzunluk uyuşmazsa null. */
export function decodeMask(width: number, height: number, maskBase64: string): SegmentationResult | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  const bytes = decodeBase64(maskBase64);
  if (!bytes || bytes.length < width * height) return null;
  return { width, height, mask: bytes.length === width * height ? bytes : bytes.subarray(0, width * height) };
}

/**
 * Web worker'daki hairAboveFace ile aynı kural: yüz kutusunun üstündeki %35'lik şeritte saç sınıfı ≥ %5 ise saç görünür.
 * landmarks normalize (0–1). Şerit görüntü dışındaysa null.
 */
export function hairAboveFace(seg: SegmentationResult, landmarks: Point[]): boolean | null {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const faceH = maxY - minY;
  const y0 = Math.max(0, Math.floor((minY - faceH * 0.35) * seg.height));
  const y1 = Math.max(0, Math.floor(minY * seg.height));
  const x0 = Math.max(0, Math.floor(minX * seg.width));
  const x1 = Math.min(seg.width, Math.ceil(maxX * seg.width));
  let hair = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      total++;
      if (seg.mask[y * seg.width + x] === SEG_CLASS.hair) hair++;
    }
  }
  return total > 0 ? hair / total >= 0.05 : null;
}
