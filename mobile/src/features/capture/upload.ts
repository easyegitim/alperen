// Ödeme sonrası görsel gönderimi (CONTRACTS_V2 §2.3/3-4): bellekteki set → POST /api/analyses/[id]/run. Hak zaten varsa
// çekim ekranı device_only yanıtından hemen sonra, yoksa satın alma eşitlemesi (/premium) ya da sonuç ekranı çağırır.
// Görseller yalnız bu istekte; başarıda geçici dosyalar silinir (uygulama yeniden başlarsa set yoktur → "Çekime dön").
import { track } from "@/lib/analytics";
import type { ClientAnalysisV2 } from "@/lib/score/present";
import { ApiClientError, type AuraApi } from "@/mobile/src/lib/api";
import { clearPendingSet, pendingSetFor } from "./captureSession";
import { buildRunBody, viewsLabel, type EncodedView } from "./payload";
import { encodeView } from "./viewImages";

export type UploadResult =
  | { ok: true; analysis: ClientAnalysisV2 }
  | { ok: false; reason: "no_set" | "front_missing" | "profile_missing" | "duplicate_view" | "unknown_view" | "image_too_large" | "images_total_too_large" | "api"; code?: string; retryAt?: string };

export async function uploadPendingSet(aura: Pick<AuraApi, "analyses">, analysisId: string, opts: { resume?: boolean; encode?: typeof encodeView } = {}): Promise<UploadResult> {
  const set = pendingSetFor(analysisId);
  if (!set) return { ok: false, reason: "no_set" };
  const encode = opts.encode ?? encodeView;
  const encoded: EncodedView[] = [];
  try {
    for (const v of set.views) encoded.push(await encode(v.uri, v.landmarksPx, v.width, v.height, v.view, v.sourceHash));
  } catch {
    // Geçici dosya yok ya da kodlama hatası (ör. ekran ayrılınca silinmiş set): fırlatmak yerine hata sonucu; set düşer.
    await clearPendingSet();
    track("analysis_failed", { reason: "GENERIC" });
    return { ok: false, reason: "api", code: "GENERIC" };
  }
  const built = buildRunBody(encoded);
  if (!built.ok) return { ok: false, reason: built.reason };
  track("full_analysis_submitted", { ...viewsLabel(built.views), hashed: built.body.sourceHashes !== undefined, resume: opts.resume === true });
  try {
    const analysis = await aura.analyses.run(analysisId, built.body);
    if (!analysis) return { ok: false, reason: "api", code: "GENERIC" };
    await clearPendingSet();
    return { ok: true, analysis };
  } catch (e) {
    const code = e instanceof ApiClientError ? e.code : "NETWORK";
    track("analysis_failed", { reason: code });
    return { ok: false, reason: "api", code, retryAt: e instanceof ApiClientError ? e.retryAt : undefined };
  }
}
