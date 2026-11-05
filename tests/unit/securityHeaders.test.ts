import { describe, expect, it } from "vitest";
import { buildCsp, securityHeaders, sentryIngestOrigin } from "@/lib/security/headers";

const env = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
  NEXT_PUBLIC_SENTRY_DSN: "https://k3y@o123.ingest.de.sentry.io/456",
};

describe("güvenlik başlıkları (SPEC 16.4)", () => {
  it("HSTS, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy camera=(self)", () => {
    const h = Object.fromEntries(securityHeaders(env).map((x) => [x.key, x.value]));
    expect(h["Strict-Transport-Security"]).toContain("max-age=63072000");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("camera=(self)");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
  });
  it("HSTS yalnız production'da", () => {
    const h = securityHeaders({ ...env, NODE_ENV: "development" }).map((x) => x.key);
    expect(h).not.toContain("Strict-Transport-Security");
  });
  it("CSP: worker-src, connect-src (Supabase, PostHog, Sentry, Turnstile), frame-src (iyzico, Turnstile), img-src", () => {
    const csp = buildCsp(env);
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("img-src 'self' data: blob:");
    const connect = csp.split("; ").find((d) => d.startsWith("connect-src")) ?? "";
    expect(connect).toContain("https://abc.supabase.co");
    expect(connect).toContain("wss://abc.supabase.co");
    expect(connect).toContain("https://eu.i.posthog.com");
    expect(connect).toContain("https://o123.ingest.de.sentry.io");
    expect(connect).toContain("https://challenges.cloudflare.com");
    const frame = csp.split("; ").find((d) => d.startsWith("frame-src")) ?? "";
    expect(frame).toContain("https://*.iyzipay.com");
    expect(frame).toContain("https://challenges.cloudflare.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });
  it("production'da script-src 'unsafe-eval' içermez; dev'de içerir (HMR)", () => {
    expect(buildCsp(env)).not.toContain("'unsafe-eval'");
    expect(buildCsp({ ...env, NODE_ENV: "development" })).toContain("'unsafe-eval'");
    expect(buildCsp(env)).toContain("'wasm-unsafe-eval'");
  });
  it("boş ortamda CSP yine geçerli", () => {
    const csp = buildCsp({ NODE_ENV: "production" });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(sentryIngestOrigin("garbage")).toBeNull();
  });
});
