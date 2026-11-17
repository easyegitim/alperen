"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { postJson } from "@/lib/api/client";
import { COOKIE_CONSENT_NAME, type CookieConsentValue } from "@/lib/consent";
import { createClient } from "@/lib/db/browser";

const ONE_YEAR = 60 * 60 * 24 * 365;

export function readCookieConsent(): CookieConsentValue | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_CONSENT_NAME}=(granted|denied)`));
  return (m?.[1] as CookieConsentValue | undefined) ?? null;
}

// Çerez değeri için küçük bir dış mağaza: yazınca aboneler yeniden okur.
const listeners = new Set<() => void>();
export const subscribeCookieConsent = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
const subscribe = subscribeCookieConsent;
/** Çerez başka yerden (hesap ayarları) yazıldığında aboneleri uyandırır. */
export const notifyCookieConsent = () => listeners.forEach((cb) => cb());
const getSnapshot = (): CookieConsentValue | "none" => readCookieConsent() ?? "none";
const getServerSnapshot = (): "pending" => "pending";

/**
 * Çerez banner'ı (SPEC Faz 3 madde 5). Tercih zorunlu bir çerezde tutulur; oturum varsa consents'e de yazılır.
 * PostHog yalnız "granted" iken başlatılır (components/providers/AnalyticsProvider.tsx).
 */
export function CookieBanner({ cookieTextVersion }: { cookieTextVersion: string }) {
  const t = useTranslations("cookies");
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const visible = snapshot === "none";

  async function choose(value: CookieConsentValue) {
    document.cookie = `${COOKIE_CONSENT_NAME}=${value}; Max-Age=${ONE_YEAR}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    listeners.forEach((cb) => cb());
    track("consent_updated", { type: "analytics_cookies", granted: value === "granted" });
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        await postJson("/api/consents", { type: "analytics_cookies", granted: value === "granted", textVersion: cookieTextVersion });
      }
    } catch {
      // Oturum/yapılandırma yoksa yalnız çerez yeterlidir.
    }
  }

  if (!visible) return null;
  return (
    <div role="dialog" aria-live="polite" aria-label={t("title")} className="fixed inset-x-0 bottom-0 z-50 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-lg space-y-3 rounded-xl border bg-background p-4 shadow-lg">
        <p className="text-sm">
          {t("body")}{" "}
          <Link href="/yasal/cerez" className="underline underline-offset-4">
            {t("link")}
          </Link>
        </p>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => choose("granted")}>
            {t("accept")}
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => choose("denied")}>
            {t("reject")}
          </Button>
        </div>
      </div>
    </div>
  );
}
