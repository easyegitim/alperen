"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { OverlaySource } from "@/components/analysis/GeometryOverlay";
import { getSessionSelfie } from "@/lib/face/sessionStore";

// Bellekteki selfie bir modül değişkenidir; abonelik gerekmez (değişimi sayfa geçişi getirir).
const subscribe = () => () => {};
const serverSnapshot = () => null;

/**
 * Bu analize bağlanmış (bindSessionSelfie) bellekteki selfie; yoksa null (UI spec S2).
 * Sunucuda ve sayfa yenilemesinden sonra her zaman null: fotoğraf hiçbir yerde saklanmaz.
 */
export function useBoundSelfie(analysisId: string): OverlaySource | null {
  const selfie = useSyncExternalStore(subscribe, getSessionSelfie, serverSnapshot);
  const boundId = selfie?.analysisId;
  return useMemo(
    () =>
      selfie && boundId === analysisId
        ? { bitmap: selfie.bitmap, width: selfie.width, height: selfie.height, landmarks: selfie.landmarks }
        : null,
    [selfie, boundId, analysisId],
  );
}
