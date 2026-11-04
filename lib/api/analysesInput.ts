import { z } from "zod";
import { SERVER_IMAGE_MAX_BYTES } from "@/lib/face/crop";
import { FRONT_MAX_BYTES, TOTAL_IMAGE_MAX_BYTES, VIEW_BY_KEY, VIEW_KEYS, checkViewSet, type AnalysisMode, type ViewKey } from "@/lib/face/views";

// SPEC 7.7 GeometryResult şeması (ham nokta dizisi kabul edilmez).
const FaceShape = z.enum(["oval", "round", "square", "long", "heart", "diamond"]);
export const GeometrySchema = z.object({
  version: z.literal("geo-v1"),
  quality: z.object({
    yaw: z.number(),
    pitch: z.number(),
    roll: z.number(),
    brightness: z.number(),
    sharpness: z.number(),
    passed: z.boolean(),
    /** Elle çekim üst verisi; skora girmez (UI spec S7). */
    relaxed: z.boolean().optional(),
  }),
  metrics: z.object({
    lengthRatio: z.number().min(0.5).max(3),
    jawRatio: z.number().min(0.2).max(2),
    foreheadRatio: z.number().min(0.2).max(2),
    fwhr: z.number().min(0.5).max(4),
    canthalTiltDeg: z.number().min(-45).max(45),
    lowerToMiddle: z.number().min(0.2).max(4),
    thirds: z.object({ upper: z.number().nullable(), middle: z.number(), lower: z.number() }),
    hairlineFound: z.boolean(),
    // fs-v2 (W1): saç çizgisi tabanlı uzunluk oranı; eski istemciler göndermez (sunucu yüz şeklini bununla yeniden hesaplar).
    faceLengthRatio: z.number().min(0.5).max(3).nullable().optional(),
    // hybrid.v1 ek metrikleri (engine spec §1.2, C1); eski istemciler için isteğe bağlı.
    ipdRatio: z.number().min(0.2).max(0.8).nullable().optional(),
    eyeMouthRatio: z.number().min(0.15).max(0.7).nullable().optional(),
    symmetry: z
      .object({ face: z.number().min(0).max(0.3), eyes: z.number().min(0).max(0.3), lower: z.number().min(0).max(0.3) })
      .nullable()
      .optional(),
  }),
  faceShape: z.object({ primary: FaceShape, secondary: FaceShape.optional(), confidence: z.number().min(0).max(1) }),
  capturedAt: z.string(),
});

/** base64 metin uzunluğu tavanı (dolgu dahil) → ham bayt tavanı. */
const b64Max = (bytes: number) => Math.ceil((bytes * 4) / 3) + 4;
/** base64 metinden yaklaşık ham bayt (dolgu düşülür). */
export function base64Bytes(data: string): number {
  const pad = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - pad;
}

export const ANALYSIS_MODES = ["device_only", "full"] as const satisfies readonly AnalysisMode[];

const ImageItem = z.object({
  view: z.enum(VIEW_KEYS),
  /** base64 JPEG (data: öneki olmadan). Görünüm başına bayt tavanı refine'da (ön 600 KB, diğerleri 400 KB). */
  data: z.string().min(100).max(b64Max(FRONT_MAX_BYTES)),
});
export type ImageItem = z.infer<typeof ImageItem>;

/** Orijinal dosyanın SHA-256'sı (hex, küçük harf); istemci hesaplar (CONTRACTS_V2 §2.3 set önbelleği). */
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * SPEC 14 / CONTRACTS_V2 §2.1: POST /api/analyses ham gövdesi. Üç biçim kabul edilir:
 *  1) v2: { mode, images[], sourceHashes? }  2) v2 device_only: images yok  3) eski: { image } (tek ön fotoğraf).
 * Doğrulama sonrası normalizeAnalysisInput tek biçime çevirir. Geometri her zaman yalnız ön fotoğrafa aittir.
 */
export const AnalysisInputRaw = z
  .object({
    clientRequestId: z.uuid(),
    geometry: GeometrySchema,
    mode: z.enum(ANALYSIS_MODES).optional(),
    images: z.array(ImageItem).max(VIEW_KEYS.length).optional(),
    /** Eski istemci (tek selfie): images verilmemişse zorunlu. */
    image: z.string().min(100).max(b64Max(SERVER_IMAGE_MAX_BYTES)).optional(),
    sourceHashes: z.array(Sha256Hex).min(1).max(VIEW_KEYS.length).optional(),
  })
  .superRefine((v, ctx) => {
    const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: "custom", message, path });
    if (v.image && v.images) return issue("image ve images birlikte gönderilemez", ["images"]);
    if (!v.image && !v.images && v.mode !== "device_only") return issue("images zorunlu (device_only dışında)", ["images"]);
    if (v.image && v.mode === "device_only") return issue("device_only modunda görsel gönderilmez", ["image"]);
    if (v.images) {
      const mode: AnalysisMode = v.mode ?? "full";
      if (mode === "device_only") {
        if (v.images.length > 0) issue("device_only modunda görsel gönderilmez", ["images"]);
        return;
      }
      const set = checkViewSet(
        v.images.map((i) => i.view),
        mode,
      );
      if (!set.ok) return issue(`view_set_${set.reason}`, ["images"]);
      let total = 0;
      v.images.forEach((img, i) => {
        const bytes = base64Bytes(img.data);
        total += bytes;
        if (bytes > VIEW_BY_KEY[img.view].maxBytes) issue(`image_too_large_${img.view}`, ["images", i, "data"]);
      });
      if (total > TOTAL_IMAGE_MAX_BYTES) issue("images_total_too_large", ["images"]);
      if (v.sourceHashes && v.images.length > 0 && v.sourceHashes.length !== v.images.length) issue("sourceHashes sayısı images ile aynı olmalı", ["sourceHashes"]);
    }
  });
export type AnalysisInputRaw = z.infer<typeof AnalysisInputRaw>;

/** Rotaya giden tek biçim (CONTRACTS_V2 §2.2). legacy: eski tek selfie gövdesi; profil şartı uygulanmaz, motor seçimi rotada. */
export type AnalysisInput = {
  clientRequestId: string;
  geometry: z.infer<typeof GeometrySchema>;
  mode: AnalysisMode;
  /** Görünüm sırası korunur; device_only'de boş. */
  images: ImageItem[];
  /** images ile aynı sırada; yoksa null (set önbelleği kullanılmaz). */
  sourceHashes: string[] | null;
  legacy: boolean;
};

/** Saf: doğrulanmış ham gövdeyi tek biçime çevirir. Eski { image } → images [{ view: "front" }], mode "full", legacy true. */
export function normalizeAnalysisInput(raw: AnalysisInputRaw): AnalysisInput {
  if (raw.image !== undefined) {
    return {
      clientRequestId: raw.clientRequestId,
      geometry: raw.geometry,
      mode: "full",
      images: [{ view: "front", data: raw.image }],
      sourceHashes: raw.sourceHashes && raw.sourceHashes.length === 1 ? raw.sourceHashes : null,
      legacy: true,
    };
  }
  const mode: AnalysisMode = raw.mode ?? (raw.images ? "full" : "device_only");
  const images = mode === "device_only" ? [] : (raw.images ?? []);
  return {
    clientRequestId: raw.clientRequestId,
    geometry: raw.geometry,
    mode,
    images,
    sourceHashes: raw.sourceHashes ?? null,
    legacy: false,
  };
}

/** Doğrulama + normalizasyon tek adımda (withGuard şeması olarak kullanılır). */
export const AnalysisInputSchema = AnalysisInputRaw.transform(normalizeAnalysisInput);

/** Görünüm → ham bayt tavanı (eski tek selfie için SERVER_IMAGE_MAX_BYTES = ön tavanı). */
export function imageMaxBytes(view: ViewKey): number {
  return VIEW_BY_KEY[view].maxBytes;
}

/** Base64'ü çözer, JPEG imzasını (FF D8 FF) ve boyutu doğrular. Hata kodu döner. */
export function decodeJpeg(base64: string, maxBytes: number = SERVER_IMAGE_MAX_BYTES): { bytes: Buffer } | { error: "IMAGE_TOO_LARGE" | "BAD_INPUT" } {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return { error: "BAD_INPUT" };
  }
  if (bytes.length > maxBytes) return { error: "IMAGE_TOO_LARGE" };
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return { error: "BAD_INPUT" };
  return { bytes };
}

export type DecodedImages = Partial<Record<ViewKey, Buffer>>;

/** Tüm görünümleri çözer; ilk hatada görünüm adıyla döner. Bellekte kalır; hiçbir yere yazılmaz. */
export function decodeImages(images: readonly ImageItem[]): { images: DecodedImages; totalBytes: number } | { error: "IMAGE_TOO_LARGE" | "BAD_INPUT"; view: ViewKey } {
  const out: DecodedImages = {};
  let total = 0;
  for (const img of images) {
    const d = decodeJpeg(img.data, imageMaxBytes(img.view));
    if ("error" in d) return { error: d.error, view: img.view };
    out[img.view] = d.bytes;
    total += d.bytes.length;
  }
  if (total > TOTAL_IMAGE_MAX_BYTES) return { error: "IMAGE_TOO_LARGE", view: images[images.length - 1]?.view ?? "front" };
  return { images: out, totalBytes: total };
}
