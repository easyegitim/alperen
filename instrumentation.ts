import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

// Sunucu bileşeni / route handler hataları. beforeSend gövdeyi temizler.
export const onRequestError = Sentry.captureRequestError;
