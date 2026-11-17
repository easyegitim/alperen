// EXPO_PUBLIC_* değerleri derlemede gömülür (SPEC-MOBILE M1). Gizli anahtar burada olamaz.
export const env = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  turnstileSiteKey: process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "",
  posthogKey: process.env.EXPO_PUBLIC_POSTHOG_KEY ?? "",
  posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? "",
} as const;

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
