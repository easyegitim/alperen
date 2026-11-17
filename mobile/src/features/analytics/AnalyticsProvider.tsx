import { useEffect, useRef } from "react";
import { setAnalyticsClient } from "@/lib/analytics";
import { env } from "@/mobile/src/lib/env";
import { readAnalyticsConsent, subscribeAnalyticsConsent, type AnalyticsConsent } from "./consent";

type Client = { capture(event: string, properties?: Record<string, unknown>): unknown; getFeatureFlag(flag: string): unknown; optIn(): Promise<void>; optOut(): Promise<void>; reset(): void };

/**
 * SPEC 17 / SPEC-MOBILE M7: PostHog yalnız analitik izni "granted" iken yüklenir ve başlatılır; izin kalkınca
 * optOut + reset. Otomatik yakalama, ekran izleme ve oturum kaydı kapalı. Olaylar lib/analytics.ts filtresinden geçer.
 */
export function AnalyticsProvider() {
  const clientRef = useRef<Client | null>(null);

  useEffect(() => {
    if (!env.posthogKey) return;
    let active = true;
    async function apply(consent: AnalyticsConsent) {
      if (consent === "granted") {
        if (!clientRef.current) {
          const { PostHog } = await import("posthog-react-native");
          if (!active) return;
          const ph = new PostHog(env.posthogKey, { host: env.posthogHost, captureAppLifecycleEvents: false, disableGeoip: true });
          clientRef.current = ph;
        }
        await clientRef.current.optIn();
        setAnalyticsClient(clientRef.current);
      } else {
        setAnalyticsClient(null);
        if (clientRef.current) {
          await clientRef.current.optOut();
          clientRef.current.reset();
        }
      }
    }
    void readAnalyticsConsent().then((c) => {
      if (active) void apply(c);
    });
    const unsub = subscribeAnalyticsConsent((c) => void apply(c));
    return () => {
      active = false;
      unsub();
      setAnalyticsClient(null);
    };
  }, []);

  return null;
}
