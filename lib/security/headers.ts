// SPEC 16.4: güvenlik başlıkları ve CSP. Saf fonksiyon; next.config.ts headers() bunu kullanır, birim testi var.
// Nonce yerine 'unsafe-inline' script: Next.js'in satır içi hidrasyon betikleri ve iyzico checkoutFormContent
// (satır içi <script>) nonce'suz çalışır. Nonce'a geçiş bilinen eksik olarak docs/security-check.md'de.

export type HeaderEnv = {
  NODE_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_POSTHOG_HOST?: string;
  NEXT_PUBLIC_SENTRY_DSN?: string;
  IYZICO_BASE_URL?: string;
};

const TURNSTILE = "https://challenges.cloudflare.com";
const IYZICO_HOSTS = ["https://*.iyzipay.com", "https://*.iyzico.com"];

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Supabase REST ve Realtime (wss) için kaynaklar. */
function supabaseSources(url: string | undefined): string[] {
  const o = originOf(url);
  if (!o) return [];
  return [o, o.replace(/^http/, "ws")];
}

/** Sentry DSN'den ingest kökeni: https://<key>@o123.ingest.de.sentry.io/456 → https://o123.ingest.de.sentry.io */
export function sentryIngestOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function buildCsp(env: HeaderEnv = process.env): string {
  const dev = env.NODE_ENV !== "production";
  const connect = [
    "'self'",
    ...supabaseSources(env.NEXT_PUBLIC_SUPABASE_URL),
    originOf(env.NEXT_PUBLIC_POSTHOG_HOST),
    sentryIngestOrigin(env.NEXT_PUBLIC_SENTRY_DSN),
    TURNSTILE,
    ...IYZICO_HOSTS,
  ].filter((s): s is string => Boolean(s));

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'wasm-unsafe-eval': MediaPipe WASM; dev'de Next HMR için 'unsafe-eval'.
    "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(dev ? ["'unsafe-eval'"] : []), TURNSTILE, ...IYZICO_HOSTS],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": connect,
    "worker-src": ["'self'", "blob:"],
    "frame-src": [TURNSTILE, ...IYZICO_HOSTS],
    "form-action": ["'self'", ...IYZICO_HOSTS],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "media-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    ...(dev ? {} : { "upgrade-insecure-requests": [] }),
  };
  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(" ")}` : k))
    .join("; ");
}

export function securityHeaders(env: HeaderEnv = process.env): { key: string; value: string }[] {
  const prod = env.NODE_ENV === "production";
  return [
    { key: "Content-Security-Policy", value: buildCsp(env) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Kamera yalnız kendi kökenimiz; mikrofon, konum vb. kapalı.
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    ...(prod ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
  ];
}
