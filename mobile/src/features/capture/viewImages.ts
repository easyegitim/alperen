// Görünüm başına sunucu kopyası (CONTRACTS_V2 §2.1: ön 768 px JPEG 0,85 ≤ 600 KB; yan açılar 640 px JPEG 0,80 ≤ 400 KB)
// ve galeri dosyasının SHA-256'sı (set önbelleği, KB Ç11). expo-image-manipulator + expo-file-system + expo-crypto;
// çıktı yalnız bellekte, yalnız POST /api/analyses/[id]/run gövdesine girer. Geçici dosyalar silinir.
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { computeCropBox, type CropBox } from "@/lib/face/crop";
import type { Point } from "@/lib/face/types";
import type { ViewKey } from "@/lib/face/views";
import { removeTempFile } from "./captureSession";
import { base64Bytes } from "./cropMath";
import { viewEncodeSpec, type EncodedView } from "./payload";

/** Yüz ağı yoksa (90° profilde ağ güvenilmez) merkez kare (lib/face/viewCrop.ts centerSquareBox ile aynı). */
export function centerSquareBox(width: number, height: number): CropBox {
  const size = Math.floor(Math.min(width, height));
  return { x: Math.floor((width - size) / 2), y: Math.floor((height - size) / 2), size };
}

export function cropBoxFor(landmarksPx: readonly Point[] | null, width: number, height: number): CropBox {
  return landmarksPx && landmarksPx.length > 0 ? computeCropBox([...landmarksPx], width, height) : centerSquareBox(width, height);
}

/** Görünüm kırpımı → JPEG base64; tavanı aşarsa kalite 0,1 adımlarla düşer (en az 0,45). */
export async function encodeView(uri: string, landmarksPx: readonly Point[] | null, width: number, height: number, view: ViewKey, sourceHash: string | null): Promise<EncodedView> {
  const spec = viewEncodeSpec(view);
  const box = cropBoxFor(landmarksPx, width, height);
  const ref = await ImageManipulator.manipulate(uri).crop({ originX: box.x, originY: box.y, width: box.size, height: box.size }).resize({ width: spec.size, height: spec.size }).renderAsync();
  try {
    let quality = spec.quality;
    for (;;) {
      const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
      const b64 = out.base64 ?? "";
      await removeTempFile(out.uri);
      const bytes = base64Bytes(b64);
      if (bytes <= spec.maxBytes || quality <= 0.45) return { view, base64: b64, bytes, sourceHash };
      quality = Math.round((quality - 0.1) * 100) / 100;
    }
  } finally {
    ref.release();
  }
}

/** Orijinal galeri dosyasının SHA-256 hex'i; okunamazsa null (hash'siz set gönderilir, önbellek kullanılmaz). */
export async function fileSha256Hex(uri: string): Promise<string | null> {
  try {
    const bytes = await new File(uri).bytes();
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
