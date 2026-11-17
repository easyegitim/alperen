// SPEC 16.4 / Faz 14 madde 2: Sentry ortak seçenekleri. sendDefaultPii false, replay kapalı,
// beforeSend ile istek gövdesi/çerez/başlık/kullanıcı temizliği. Loglara görsel, e-posta, skor, metrik girmez.
import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const SENSITIVE_KEYS = /^(image|photo|selfie|landmarks|points|email|contact|overall|potential|subscores|metrics|geometry|raw_overall|score)$/i;
const B64_JPEG = /\/9j\/[A-Za-z0-9+/=]{32,}/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Metinlerde base64 JPEG ve e-posta kalıplarını maskeler. */
export function scrubText(s: string): string {
  return s.replace(B64_JPEG, "[jpeg]").replace(EMAIL, "[email]");
}

/** Nesnelerde hassas anahtarları ve uzun dizileri temizler (derinlik sınırlı). */
export function scrubValue(v: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (typeof v === "string") return scrubText(v.length > 2000 ? `${v.slice(0, 2000)}…` : v);
  if (Array.isArray(v)) return v.length > 50 ? `[array:${v.length}]` : v.map((x) => scrubValue(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "[redacted]" : scrubValue(val, depth + 1);
    }
    return out;
  }
  return v;
}

/** beforeSend: gövde, çerez, başlık, kullanıcı ve breadcrumb verisi gitmez. */
export function beforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  void _hint;
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    if (event.request.url) event.request.url = event.request.url.split("?")[0];
    if (event.request.query_string) delete event.request.query_string;
  }
  delete event.user;
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrubValue(event.contexts) as ErrorEvent["contexts"];
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({
      ...b,
      message: b.message ? scrubText(b.message) : b.message,
      data: b.data ? (scrubValue(b.data) as Record<string, unknown>) : b.data,
    }));
  }
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
  }
  return event;
}

export const SENTRY_COMMON = {
  sendDefaultPii: false as const,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  maxBreadcrumbs: 30,
  beforeSend,
  // Dosya seçici/kamera akışı gibi gürültülü tarayıcı hataları
  ignoreErrors: ["ResizeObserver loop", "AbortError", "NotAllowedError"] as (string | RegExp)[],
};
