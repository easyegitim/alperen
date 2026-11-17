import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { securityHeaders } from "./lib/security/headers";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // SPEC 16.4: tüm yollarda güvenlik başlıkları ve CSP (lib/security/headers.ts, birim testli).
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders() }];
  },
};

// Sentry: DSN yoksa SDK devre dışı kalır (lib/monitoring/sentry.ts). Build'de kaynak haritası yüklemesi
// yalnız SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT varsa yapılır; yoksa sessizce atlanır.
export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  telemetry: false,
  widenClientFileUpload: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  bundleSizeOptimizations: { excludeDebugStatements: true, excludeReplayShadowDom: true, excludeReplayIframe: true, excludeReplayWorker: true },
});
