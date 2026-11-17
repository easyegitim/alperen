// Sentry (React Native) — SPEC 16.4: sendDefaultPii false, beforeSend gövde temizliği, replay/ekran görüntüsü kapalı.
import * as Sentry from "@sentry/react-native";
import { scrubText, scrubValue } from "@/lib/monitoring/sentry";
import { env } from "./env";

type RnErrorEvent = Parameters<NonNullable<Parameters<typeof Sentry.init>[0]["beforeSend"]>>[0];

/** Web beforeSend ile aynı kurallar (lib/monitoring/sentry.ts): istek verisi, kullanıcı, e-posta, base64 JPEG, skor alanları gitmez. */
export function scrubRnEvent(event: RnErrorEvent): RnErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    if (event.request.url) event.request.url = event.request.url.split("?")[0];
    delete event.request.query_string;
  }
  delete event.user;
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrubValue(event.contexts) as RnErrorEvent["contexts"];
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({ ...b, message: b.message ? scrubText(b.message) : b.message, data: b.data ? (scrubValue(b.data) as Record<string, unknown>) : b.data }));
  }
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = scrubText(ex.value);
  return event;
}

let started = false;
export function initMonitoring(): void {
  if (started || !env.sentryDsn) return;
  started = true;
  Sentry.init({
    dsn: env.sentryDsn,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableCaptureFailedRequests: false,
    maxBreadcrumbs: 30,
    beforeSend: (event) => scrubRnEvent(event),
    ignoreErrors: ["AbortError", "NotAllowedError"],
  });
}

export const wrapRoot = <P extends Record<string, unknown>>(c: React.ComponentType<P>) => (env.sentryDsn ? Sentry.wrap(c) : c);
