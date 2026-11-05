"use client";

// SPEC 7.2 görüntü ön işleme (istemci). Dosya hiçbir yere gönderilmez.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ANALYSIS_LONG_SIDE = 1280;
export const ANALYSIS_MIN_SHORT_SIDE = 640;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export type PreprocessErrorCode = "bad_type" | "too_large" | "too_small" | "decode_failed";

export class PreprocessError extends Error {
  constructor(readonly code: PreprocessErrorCode) {
    super(code);
  }
}

export type LoadedImage = { bitmap: ImageBitmap; width: number; height: number };

/** Dosya tipi/boyut kontrolü, EXIF yönü düzeltmesi, uzun kenar ≤ 1280 px. */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  const type = file.type || guessType(file.name);
  if (!ACCEPTED_TYPES.has(type)) throw new PreprocessError("bad_type");
  if (file.size > MAX_UPLOAD_BYTES) throw new PreprocessError("too_large");
  let original: ImageBitmap;
  try {
    original = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PreprocessError("decode_failed"); // HEIC desteklemeyen tarayıcı dahil
  }
  try {
    if (Math.min(original.width, original.height) < ANALYSIS_MIN_SHORT_SIDE) throw new PreprocessError("too_small");
    return await resizeToAnalysis(original);
  } finally {
    original.close();
  }
}

/** Kameradan veya dosyadan gelen bitmap'i analiz boyutuna (uzun kenar ≤ 1280) getirir. Girdi kapatılmaz. */
export async function resizeToAnalysis(src: ImageBitmap): Promise<LoadedImage> {
  const scale = Math.min(1, ANALYSIS_LONG_SIDE / Math.max(src.width, src.height));
  const width = Math.round(src.width * scale);
  const height = Math.round(src.height * scale);
  const bitmap = await createImageBitmap(src, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
  return { bitmap, width, height };
}

function guessType(name: string): string {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  return "";
}
