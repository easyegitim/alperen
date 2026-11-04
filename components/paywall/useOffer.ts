"use client";

import { useEffect, useRef, useState } from "react";
import type { OfferResponse } from "@/lib/billing/offer";

export type OfferFetch = { status: "idle" | "loading" | "ready" | "error"; offer: OfferResponse | null; /** Sunucu saati − cihaz saati (ms); geri sayım buna göre. */ skewMs: number };

/**
 * GET /api/billing/offer: yalnız `enabled` olunca (sheet açılınca) bir kez. Teklif sunucuda tutulur; burada yalnız
 * okunur. Saat kayması: remainingMs sunucu değeriyle alınan anda eşlenir.
 */
export function useOffer(enabled: boolean): OfferFetch {
  const [result, setResult] = useState<Omit<OfferFetch, "status"> & { status: "ready" | "error" } | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    let cancelled = false;
    fetch("/api/billing/offer", { credentials: "same-origin", cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as OfferResponse) : null))
      .then((offer) => {
        if (cancelled) return;
        if (!offer) setResult({ status: "error", offer: null, skewMs: 0 });
        else setResult({ status: "ready", offer, skewMs: new Date(offer.serverNow).getTime() - Date.now() });
      })
      .catch(() => {
        if (!cancelled) setResult({ status: "error", offer: null, skewMs: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  if (result) return result;
  return { status: enabled ? "loading" : "idle", offer: null, skewMs: 0 };
}

/** Kalan süre (ms), sunucu saatine göre; hiç negatif olmaz. */
export function remainingMs(offer: OfferResponse, skewMs: number, now: number = Date.now()): number {
  return Math.max(0, new Date(offer.expiresAt).getTime() - (now + skewMs));
}
