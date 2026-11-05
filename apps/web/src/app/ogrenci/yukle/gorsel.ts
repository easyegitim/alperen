// Tarayıcıda sayfa hazırlığı: görsel uzun kenarı ≤ 2576 px olacak şekilde canvas ile JPEG'e küçültülür (EXIF yönü
// uygulanır, konum vb. üst veri atılır); PDF olduğu gibi gider. Yalnız 'use client' bileşenlerinden çağrılır.
import { fitWithin, UPLOAD_LIMITS, type StoredMime } from '@/server/uploads/shared';

export interface PreparedPage {
  blob: Blob;
  mime: StoredMime;
  bytes: number;
  width: number | null;
  height: number | null;
  sha256: string | null;
}

export class PrepareError extends Error {}

export function newUploadId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function sha256Hex(blob: Blob): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
  } catch {
    return null; // güvenli bağlam değil: özet isteğe bağlı
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new PrepareError('Fotoğraf hazırlanamadı.'))), 'image/jpeg', UPLOAD_LIMITS.jpegQuality),
  );
}

export async function preparePage(file: File): Promise<PreparedPage> {
  if (file.type === 'application/pdf') {
    if (file.size > UPLOAD_LIMITS.maxPdfBytes) throw new PrepareError('PDF çok büyük (en çok 20 MB).');
    return { blob: file, mime: 'application/pdf', bytes: file.size, width: null, height: null, sha256: await sha256Hex(file) };
  }
  if (!file.type.startsWith('image/')) throw new PrepareError('Yalnız fotoğraf ya da PDF ekleyebilirsin.');
  if (file.size > UPLOAD_LIMITS.maxRawImageBytes) throw new PrepareError('Fotoğraf çok büyük.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PrepareError('Bu fotoğraf açılamadı. JPEG ya da PNG olarak yeniden dene.');
  }
  const size = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PrepareError('Fotoğraf hazırlanamadı.');
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await canvasToJpeg(canvas);
  if (blob.size > UPLOAD_LIMITS.maxStoredBytes) throw new PrepareError('Fotoğraf çok büyük.');
  return { blob, mime: 'image/jpeg', bytes: blob.size, width: size.width, height: size.height, sha256: await sha256Hex(blob) };
}
