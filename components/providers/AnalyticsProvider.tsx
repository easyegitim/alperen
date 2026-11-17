"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { readCookieConsent, subscribeCookieConsent } from "@/components/legal/CookieBanner";
import { setAnalyticsClient } from "@/lib/analytics";

const getSnapshot = () => readCookieConsent() ?? "none";
const getServerSnapshot = () => "pending" as const;

/**
 * SPEC 17 / Faz 14 madde 1: PostHog yalnız çerez onayı "granted" iken yüklenir ve başlatılır.
 * Onay geri alınınca veri toplama durur ve yerel kimlik sıfırlanır. Oturum kaydı ve otomatik yakalama kapalı.
 * Fotoğraf, skor, metrik, e-posta hiçbir olaya girmez (lib/analytics.ts).
 */
export function AnalyticsProvider() {
  const consent = useSyncExternalStore(subscribeCookieConsent, getSnapshot, getServerSnapshot);
  const pathname = usePathname();

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";
    if (!key) return;
    let cancelled = false;
    if (consent === "granted") {
      void import("posthog-js").then(({ default: posthog }) => {
        if (cancelled) return;
        if (!posthog.__loaded) {
          posthog.init(key, {
            api_host: host,
            autocapture: false,
            capture_pageview: false,
            capture_pageleave: false,
            disable_session_recording: true,
            disable_surveys: true,
            person_profiles: "identified_only",
            persistence: "localStorage+cookie",
            mask_all_text: true,
            mask_all_element_attributes: true,
            // Sorgu dizesi (auth_error, token) olaylara girmez
            sanitize_properties: (props) => {
              if (typeof props.$current_url === "string") props.$current_url = props.$current_url.split("?")[0];
              delete props.$referrer;
              return props;
            },
          });
        } else if (posthog.has_opted_out_capturing()) {
          posthog.opt_in_capturing();
        }
        setAnalyticsClient(posthog);
      });
    } else if (consent === "denied") {
      void import("posthog-js").then(({ default: posthog }) => {
        if (cancelled) return;
        setAnalyticsClient(null);
        if (posthog.__loaded) {
          posthog.opt_out_capturing();
          posthog.reset();
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [consent]);

  // Sayfa görüntüleme: yalnız yol (sorgu yok)
  useEffect(() => {
    if (consent !== "granted") return;
    void import("posthog-js").then(({ default: posthog }) => {
      if (posthog.__loaded && !posthog.has_opted_out_capturing()) posthog.capture("$pageview", { $current_url: `${location.origin}${pathname}` });
    });
  }, [consent, pathname]);

  return null;
}
