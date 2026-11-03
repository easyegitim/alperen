/**
 * İstemcide görsel küçültme (PLAN-v2 §2: uzun kenar ≤ 2576 px, JPEG). Boyutu uygun ama bayt sınırını
 * (`CHAT_UPLOAD_LIMITS.photoBytes`, base64 hâliyle 5 MB) aşan görsel de yeniden sıkıştırılır: önce kalite, gerekirse
 * kenar düşürülür. Tarayıcı dışında (test) dosya aynen döner.
 */
import { CHAT_UPLOAD_LIMITS } from '@/lib/chat';

export const MAX_EDGE = 2576;
const QUALITIES = [0.86, 0.72, 0.6] as const;

export interface PreparedFile {
  file: Blob;
  name: string;
  type: string;
  width: number | null;
  height: number | null;
}

function encode(bmp: ImageBitmap, w: number, h: number, quality: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas yok');
  ctx.drawImage(bmp, 0, 0, w, h);
  return new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
}

export async function prepareImage(file: File, maxEdge = MAX_EDGE, maxBytes: number = CHAT_UPLOAD_LIMITS.photoBytes): Promise<PreparedFile> {
  if (file.type === 'application/pdf' || typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return { file, name: file.name, type: file.type, width: null, height: null };
  }
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    let w = Math.round(bmp.width * scale);
    let h = Math.round(bmp.height * scale);
    const keep = scale === 1 && file.size <= maxBytes && (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp');
    if (keep) {
      bmp.close();
      return { file, name: file.name, type: file.type, width: w, height: h };
    }
    let blob: Blob | null = null;
    // En çok iki kenar düşürme turu (her biri ×0,75), her turda kalite sırayla düşer.
    for (let round = 0; round < 3 && !(blob && blob.size <= maxBytes); round++) {
      if (round > 0) {
        w = Math.max(1, Math.round(w * 0.75));
        h = Math.max(1, Math.round(h * 0.75));
      }
      for (const q of QUALITIES) {
        blob = await encode(bmp, w, h, q);
        if (blob && blob.size <= maxBytes) break;
      }
    }
    bmp.close();
    if (!blob) throw new Error('toBlob boş');
    return { file: blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', width: w, height: h };
  } catch {
    return { file, name: file.name, type: file.type, width: null, height: null };
  }
}
