// Görüntü işleme: expo-image-manipulator (yeniden boyutlandırma/kırpma/JPEG) + Skia (piksel okuma). Dosyalar uygulama
// önbelleğinde geçicidir ve işlem sonunda silinir; sunucuya yalnız 768 px JPEG base64 gider (SPEC 7.2).
import { AlphaType, ColorType, Skia } from "@shopify/react-native-skia";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { computeCropBox, type CropBox } from "@/lib/face/crop";
import { faceBoxToPixels, pixelStatsFromRgba, type PixelStats } from "@/lib/face/pixelStats";
import { faceBox } from "@/lib/face/quality";
import type { Point } from "@/lib/face/types";
import { analysisSize, base64Bytes, serverCrop } from "@/mobile/src/features/capture/cropMath";

export type LocalImage = { uri: string; width: number; height: number };

/** Uzun kenar ≤ 1280 analiz kopyası (JPEG 0,92). */
export async function resizeToAnalysis(uri: string, width: number, height: number): Promise<LocalImage> {
  const target = analysisSize(width, height);
  const ref = await ImageManipulator.manipulate(uri).resize(target).renderAsync();
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
  ref.release();
  return { uri: out.uri, width: out.width, height: out.height };
}

/** Parlaklık/denge/netlik: 256 px kopya Skia ile okunur, yüz kutusu kesilir, ortak saf fonksiyon çalışır. */
export async function pixelStatsFor(uri: string, landmarks: Point[]): Promise<PixelStats> {
  const S = 256;
  const ref = await ImageManipulator.manipulate(uri).resize({ width: S, height: S }).renderAsync();
  const small = await ref.saveAsync({ format: SaveFormat.PNG });
  ref.release();
  try {
    const data = await Skia.Data.fromURI(small.uri);
    const img = Skia.Image.MakeImageFromEncoded(data);
    if (!img) return { brightness: null, brightnessBalance: null, sharpness: null };
    const b = faceBox(landmarks);
    const { x0, y0, w, h } = faceBoxToPixels(b, S);
    if (w < 8 || h < 8) return { brightness: null, brightnessBalance: null, sharpness: null };
    const px = img.readPixels(x0, y0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    img.dispose();
    if (!px) return { brightness: null, brightnessBalance: null, sharpness: null };
    return pixelStatsFromRgba(px, w, h);
  } finally {
    await deleteQuietly(small.uri);
  }
}

/** Kare kırpım (lib/face/crop.ts kutusu) → size px JPEG; base64 ≤ maxBytes olana kadar kalite düşer. Kırpım kutusunu da döner. */
export async function cropSquareBase64(uri: string, landmarksPx: Point[], width: number, height: number, size: number, maxBytes: number, startQuality = 0.85): Promise<{ base64: string; bytes: number; box: CropBox; uri: string }> {
  const box = computeCropBox(landmarksPx, width, height);
  let quality = startQuality;
  const ref = await ImageManipulator.manipulate(uri).crop({ originX: box.x, originY: box.y, width: box.size, height: box.size }).resize({ width: size, height: size }).renderAsync();
  try {
    for (;;) {
      const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
      const b64 = out.base64 ?? "";
      const bytes = base64Bytes(b64);
      if (bytes <= maxBytes || quality <= 0.5) return { base64: b64, bytes, box, uri: out.uri };
      await deleteQuietly(out.uri);
      quality = Math.round((quality - 0.1) * 100) / 100;
    }
  } finally {
    ref.release();
  }
}

/** Sunucu kopyası: yüz+saç kare kırpım → 768 px JPEG; base64 ≤ 600 KB olana kadar kalite düşer (lib/face/crop.ts kuralı). */
export async function cropForServerBase64(uri: string, landmarksPx: Point[], width: number, height: number): Promise<{ base64: string; bytes: number }> {
  const { box, size, maxBytes } = serverCrop(landmarksPx, width, height);
  let { quality } = serverCrop(landmarksPx, width, height);
  const ref = await ImageManipulator.manipulate(uri).crop({ originX: box.x, originY: box.y, width: box.size, height: box.size }).resize({ width: size, height: size }).renderAsync();
  try {
    for (;;) {
      const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
      const b64 = out.base64 ?? "";
      await deleteQuietly(out.uri);
      const bytes = base64Bytes(b64);
      if (bytes <= maxBytes || quality <= 0.5) return { base64: b64, bytes };
      quality = Math.round((quality - 0.1) * 100) / 100;
    }
  } finally {
    ref.release();
  }
}

export async function deleteQuietly(uri: string | null | undefined): Promise<void> {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // geçici dosya zaten yok
  }
}
