// Sunucuya giden gövdeler (CONTRACTS_V2 §2.2): ödeme öncesi device_only (GÖRSEL YOK) ve ödeme sonrası
// POST /api/analyses/[id]/run (ön 768 px + yan açılar 640 px JPEG; görünüm ve toplam bayt tavanları). Saf; birim testli.
import type { GeometryResult } from "@/lib/face/types";
import { sourceHashesFor } from "@/lib/face/hash";
import { TOTAL_IMAGE_MAX_BYTES, VIEW_BY_KEY, checkViewSet, type ViewKey } from "@/lib/face/views";
import type { AnalysisRunInput } from "@/mobile/src/lib/api";
import { base64Bytes } from "./cropMath";

export type EncodedView = { view: ViewKey; base64: string; bytes: number; sourceHash: string | null };

/** Görünüm başına kırpım/kalite/tavan (lib/face/views.ts VIEWS). */
export function viewEncodeSpec(view: ViewKey): { size: number; quality: number; maxBytes: number } {
  const s = VIEW_BY_KEY[view];
  return { size: s.cropPx, quality: s.jpegQuality, maxBytes: s.maxBytes };
}

export type RunBodyResult = { ok: true; body: AnalysisRunInput; views: ViewKey[] } | { ok: false; reason: "front_missing" | "profile_missing" | "duplicate_view" | "unknown_view" | "image_too_large" | "images_total_too_large"; view?: ViewKey };

/**
 * Ödeme sonrası set: ön + en az bir profil; görünüm tavanı ve toplam tavan (ham bayt). sourceHashes yalnız bütün
 * görseller galeri dosyasından geldiyse (kamera çekimi yeni set, KB Ç11).
 */
export function buildRunBody(encoded: readonly EncodedView[]): RunBodyResult {
  const check = checkViewSet(encoded.map((e) => e.view), "full");
  if (!check.ok) return { ok: false, reason: check.reason };
  let total = 0;
  for (const e of encoded) {
    const bytes = e.bytes || base64Bytes(e.base64);
    if (bytes > VIEW_BY_KEY[e.view].maxBytes) return { ok: false, reason: "image_too_large", view: e.view };
    total += bytes;
  }
  if (total > TOTAL_IMAGE_MAX_BYTES) return { ok: false, reason: "images_total_too_large" };
  const sourceHashes = sourceHashesFor(encoded.map((e) => e.sourceHash));
  return {
    ok: true,
    views: encoded.map((e) => e.view),
    body: { images: encoded.map((e) => ({ view: e.view, data: e.base64 })), ...(sourceHashes ? { sourceHashes } : {}) },
  };
}

export type DeviceOnlyBody = { clientRequestId: string; geometry: GeometryResult; sourceHashes?: string[] };

/**
 * Ödeme öncesi gövde: yalnız geometri (+ set hash'leri). Görsel alanı yoktur; tip de izin vermez.
 * relaxed yalnız saklanan üst veridir; hiçbir skoru değiştirmez (C7).
 */
export function buildDeviceOnlyBody(args: { clientRequestId: string; geometry: GeometryResult; relaxed: boolean; hashes: readonly (string | null)[] }): DeviceOnlyBody {
  const geometry: GeometryResult = args.relaxed ? { ...args.geometry, quality: { ...args.geometry.quality, relaxed: true } } : args.geometry;
  const sourceHashes = sourceHashesFor(args.hashes);
  return { clientRequestId: args.clientRequestId, geometry, ...(sourceHashes ? { sourceHashes } : {}) };
}

/** Analitik için açı listesi (yalnız adlar; görsel/hash yok). */
export function viewsLabel(views: readonly ViewKey[]): { views: string; count: number } {
  return { views: views.join(","), count: views.length };
}
