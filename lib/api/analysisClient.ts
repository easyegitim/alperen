"use client";

import { postJson } from "./client";
import type { GeometryResult } from "@/lib/face/types";
import type { ViewKey } from "@/lib/face/views";
import type { ClientAnalysis, ClientAnalysisV2 } from "@/lib/score/present";

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) s += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(s);
}

/** Eski tek selfie gövdesi (legacy motorlar). Görsel yalnız bu isteğe gider (gizlilik testi bunu doğrular). */
export async function submitAnalysis(params: { clientRequestId: string; geometry: GeometryResult; image: Blob }): Promise<ClientAnalysis> {
  const image = await blobToBase64(params.image);
  const res = await postJson<ClientAnalysis>("/api/analyses", { clientRequestId: params.clientRequestId, geometry: params.geometry, image });
  if (!res) throw new Error("empty_response");
  return res;
}

/**
 * v2 ödeme öncesi (CONTRACTS_V2 §2.3/1): yalnız geometri (+ varsa set hash'leri). Görsel GÖNDERİLMEZ; LLM çağrılmaz;
 * kota sayılmaz. Yanıt: kilitli ClientAnalysisV2 (stage device_only).
 */
export async function submitDeviceAnalysis(params: { clientRequestId: string; geometry: GeometryResult; sourceHashes: string[] | null }): Promise<ClientAnalysisV2> {
  const res = await postJson<ClientAnalysisV2>("/api/analyses", {
    clientRequestId: params.clientRequestId,
    geometry: params.geometry,
    mode: "device_only",
    ...(params.sourceHashes ? { sourceHashes: params.sourceHashes } : {}),
  });
  if (!res) throw new Error("empty_response");
  return res;
}

export type ViewImage = { view: ViewKey; blob: Blob; sourceHash: string | null };

/**
 * v2 ödeme sonrası (CONTRACTS_V2 §2.3/3): aynı clientRequestId ile ön + yan profil (+ isteğe bağlı açılar) tek POST'ta.
 * sourceHashes yalnız bütün görseller galeri dosyasından geldiyse gönderilir (kamera çekimi yeni set, KB Ç11).
 */
export async function submitFullAnalysis(params: { clientRequestId: string; geometry: GeometryResult; images: ViewImage[] }): Promise<ClientAnalysisV2> {
  const images = await Promise.all(params.images.map(async (i) => ({ view: i.view, data: await blobToBase64(i.blob) })));
  const hashes = params.images.map((i) => i.sourceHash);
  const sourceHashes = hashes.every((h): h is string => h !== null) ? hashes : null;
  const res = await postJson<ClientAnalysisV2>("/api/analyses", {
    clientRequestId: params.clientRequestId,
    geometry: params.geometry,
    mode: "full",
    images,
    ...(sourceHashes ? { sourceHashes } : {}),
  });
  if (!res) throw new Error("empty_response");
  return res;
}

/**
 * Ödeme sonrası görsel gönderimi (CONTRACTS_V2 §2.3/3 + PLAN 3a retry): POST /api/analyses/[id]/run. device_only satırı
 * kotaya sayılıp sıraya alınır; failed/takılı iş yeniden başlar. Görseller sunucuda saklanmadığı için set her seferinde
 * istemciden gider; sourceHashes yalnız bütün görseller galeri dosyasıysa (KB Ç11). Yanıt: 202 ClientAnalysisV2 (queued/running).
 */
export async function submitRunAnalysis(params: { analysisId: string; images: ViewImage[] }): Promise<ClientAnalysisV2> {
  const images = await Promise.all(params.images.map(async (i) => ({ view: i.view, data: await blobToBase64(i.blob) })));
  const hashes = params.images.map((i) => i.sourceHash);
  const sourceHashes = hashes.every((h): h is string => h !== null) ? hashes : null;
  const res = await postJson<ClientAnalysisV2>(`/api/analyses/${encodeURIComponent(params.analysisId)}/run`, { images, ...(sourceHashes ? { sourceHashes } : {}) });
  if (!res) throw new Error("empty_response");
  return res;
}
