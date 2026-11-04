"use client";

import { Timer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { formatRemaining, type OfferResponse } from "@/lib/billing/offer";
import { remainingMs } from "./useOffer";

/**
 * Gerçek süreli teklif geri sayımı (KB P#18): süre sunucudan, saat kaymasına göre düzeltilir; 0 olunca
 * "süresi doldu" (fiyat normal). Saniyede bir yenilenir; ekran okuyucu yalnız dakika değişince duyar.
 */
export function OfferCountdown({ offer, skewMs, onEnded }: { offer: OfferResponse; skewMs: number; onEnded?: () => void }) {
  const t = useTranslations("paywall.v2");
  const [now, setNow] = useState(() => Date.now());
  const left = remainingMs(offer, skewMs, now);
  const ended = left <= 0;
  useEffect(() => {
    if (ended) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ended]);
  useEffect(() => {
    if (ended) onEnded?.();
  }, [ended, onEnded]);

  if (left <= 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-muted/60 px-3.5 py-2.5 text-[13px] text-muted-foreground">
        <Timer aria-hidden="true" className="size-4 shrink-0" />
        {t("offerEnded")}
      </p>
    );
  }
  const text = formatRemaining(left);
  const minutes = Math.floor(left / 60_000);
  return (
    <p className="flex items-center justify-between gap-3 rounded-xl bg-brand-soft px-3.5 py-2.5 text-[13px] font-medium">
      <span className="flex items-center gap-2">
        <Timer aria-hidden="true" className="size-4 shrink-0 text-brand" />
        {t("offerRemaining")}
      </span>
      <span className="num text-base font-bold tabular-nums" aria-hidden="true">
        {text}
      </span>
      <span className="sr-only" aria-live="polite">
        {t("offerAria", { time: `${minutes} dk` })}
      </span>
    </p>
  );
}
