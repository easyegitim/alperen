// Analitik izni (web'deki analytics_cookies çerezinin mobil karşılığı): AsyncStorage'da tutulur; sunucu rızası ayrıca
// /api/consents ile kaydedilir. PostHog yalnız "granted" iken başlatılır (SPEC 17 / SPEC-MOBILE M7).
import AsyncStorage from "@react-native-async-storage/async-storage";

export const ANALYTICS_CONSENT_KEY = "aura.analytics_consent.v1";
export type AnalyticsConsent = "granted" | "denied" | "unset";

const listeners = new Set<(v: AnalyticsConsent) => void>();
let cached: AnalyticsConsent | null = null;

export function parseConsent(raw: string | null | undefined): AnalyticsConsent {
  return raw === "granted" || raw === "denied" ? raw : "unset";
}

export async function readAnalyticsConsent(): Promise<AnalyticsConsent> {
  if (cached) return cached;
  cached = parseConsent(await AsyncStorage.getItem(ANALYTICS_CONSENT_KEY).catch(() => null));
  return cached;
}

export async function setAnalyticsConsent(granted: boolean): Promise<void> {
  cached = granted ? "granted" : "denied";
  await AsyncStorage.setItem(ANALYTICS_CONSENT_KEY, cached).catch(() => undefined);
  listeners.forEach((cb) => cb(cached!));
}

export function subscribeAnalyticsConsent(cb: (v: AnalyticsConsent) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
