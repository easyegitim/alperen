"use client";

// SPEC 10.3 adım 3: son analizdeki selfie ve landmark'lar oturum boyunca yalnız bellekte; IndexedDB'ye yazılmaz.
// v2 (KB P#4): ön fotoğraf dışındaki açılar da (profil, 45°, saç çizgisi) ödeme sonrası tek POST için bellekte tutulur;
// hiçbiri depolamaya, analitiğe veya ağa (POST /api/analyses dışında) çıkmaz.
import type { Point } from "./types";
import type { ViewKey } from "./views";

export type SessionSelfie = {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  landmarks: Point[];
  capturedAt: number;
  /** Bu selfie'nin bağlandığı analiz (UI spec S1); katman yalnız eşleşen analizde fotoğraf üzerine çizilir. */
  analysisId?: string;
};

/** Ön dışındaki açı: ham noktası yok; yalnız bitmap ve (galeri dosyasıysa) orijinal dosya hash'i. */
export type SessionView = {
  view: ViewKey;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** Orijinal dosyanın SHA-256 hex'i (yalnız galeriden); kamera çekimi her zaman yeni set (KB Ç11). */
  sourceHash: string | null;
};

let current: SessionSelfie | null = null;
let views: SessionView[] = [];
/** Ön fotoğrafın orijinal dosya hash'i (galeri) — sourceHashes[] ile aynı sırada gider. */
let frontHash: string | null = null;

export function setSessionSelfie(s: SessionSelfie | null) {
  if (current && current !== s) current.bitmap.close();
  current = s;
}
export function getSessionSelfie(): SessionSelfie | null {
  return current;
}
/** Selfie'yi analize bağlar; yalnız bellekteki selfie hâlâ aynı çekimse (capturedAt eşleşirse). */
export function bindSessionSelfie(analysisId: string, capturedAt: number): void {
  if (current && current.capturedAt === capturedAt) current.analysisId = analysisId;
}

/** Yan açıları değiştirir; eskileri kapatır. */
export function setSessionViews(next: SessionView[], hashOfFront: string | null): void {
  for (const v of views) if (!next.includes(v)) v.bitmap.close();
  views = next;
  frontHash = hashOfFront;
}
export function getSessionViews(): { views: SessionView[]; frontHash: string | null } {
  return { views, frontHash };
}
export function clearSessionViews(): void {
  setSessionViews([], null);
}
