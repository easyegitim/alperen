// SPEC 10.3 adım 3: selfie + landmark'lar oturum boyunca yalnız bellekte/önbellekte (kalıcı depoya yazılmaz; ağa gitmez).
// v2: kilitli sonuç ekranındaki portre ve plan önizlemeleri yalnız bu analize bağlı selfie üzerine çizilir (analysisId).
import type { Point } from "@/lib/face/types";

export type SessionSelfie = { uri: string; width: number; height: number; landmarksPx: Point[]; capturedAt: number; analysisId?: string };

let current: SessionSelfie | null = null;

export function setSessionSelfie(s: SessionSelfie | null): void {
  current = s;
}
export function getSessionSelfie(): SessionSelfie | null {
  return current;
}
/** Selfie'yi analize bağlar; yalnız bellekteki selfie hâlâ aynı çekimse (capturedAt eşleşirse). */
export function bindSessionSelfie(analysisId: string, capturedAt: number): void {
  if (current && current.capturedAt === capturedAt) current.analysisId = analysisId;
}
/** Bu analize bağlı selfie (yoksa null → şematik yüz). */
export function boundSelfieFor(analysisId: string): SessionSelfie | null {
  return current && current.analysisId === analysisId ? current : null;
}
