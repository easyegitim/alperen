// Ödeme sonrası tek POST için çekim seti yalnız bellekte/önbellek dosyasında (web lib/face/sessionStore.ts karşılığı;
// SPEC-MOBILE M4/M7). Kalıcı depoya yazılmaz, analitiğe/loga girmez, ağa yalnız POST /api/analyses/[id]/run ile çıkar.
// Hayalet kılavuz (S3.3.4) de burada: 43 noktalık çizgi, ilerleme kaydıyla saklanması W7b (progressStore.ghost).
import type { GhostOutline } from "@/lib/face/ghostGuide";
import type { Point } from "@/lib/face/types";
import type { ViewKey } from "@/lib/face/views";
import { File } from "expo-file-system";

export type PendingView = {
  view: ViewKey;
  /** Analiz kopyası (uzun kenar ≤ 1280) — uygulama önbelleğinde geçici dosya. */
  uri: string;
  width: number;
  height: number;
  /** Yalnız önde: piksel koordinatlı noktalar (kırpım kutusu için); hiçbir yere gönderilmez. */
  landmarksPx: Point[] | null;
  /** Orijinal dosyanın SHA-256'sı (yalnız galeriden); kamerada null. */
  sourceHash: string | null;
};

export type PendingSet = { analysisId: string | null; views: PendingView[]; capturedAt: number };

let pending: PendingSet | null = null;
let lastGhost: GhostOutline | null = null;

/** Geçici dosyayı siler (expo-file-system; Skia'sız — birim testler bu modülü yükleyebilsin). */
export async function removeTempFile(uri: string | null | undefined): Promise<void> {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // geçici dosya zaten yok
  }
}

export function setPendingSet(next: PendingSet | null): void {
  pending = next;
}
export function getPendingSet(): PendingSet | null {
  return pending;
}
/** Seti analize bağlar (device_only yanıtı gelince); sonra /premium ya da sonuç ekranı bu kimlikle gönderir. */
export function bindPendingSet(analysisId: string): void {
  if (pending) pending = { ...pending, analysisId };
}
/** Bu analize ait set var mı (uygulama yeniden başladıysa yoktur → "Çekime dön"). */
export function pendingSetFor(analysisId: string): PendingSet | null {
  return pending && pending.analysisId === analysisId ? pending : null;
}
/** Geçici dosyalar silinir; bellek boşalır. */
export async function clearPendingSet(): Promise<void> {
  const p = pending;
  pending = null;
  if (!p) return;
  await Promise.all(p.views.map((v) => removeTempFile(v.uri)));
}

export function setLastGhost(g: GhostOutline | null): void {
  lastGhost = g;
}
export function getLastGhost(): GhostOutline | null {
  return lastGhost;
}
