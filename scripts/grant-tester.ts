/**
 * Test hesabı aboneliği (yalnız ekip içi test; ödeme sağlayıcısı yok).
 *
 * Bir hesaba süresiz "comp" abonelik (plan: monthly, provider: comp) ve sınırsız kota
 * (profiles.unlimited_quota, 0008) verir ya da geri alır. Hak yine sunucudan gelir (subscriptions satırı);
 * istemci hiçbir şeyi açmaz. Skor ve kalibrasyon herkes için aynı kalır (K1): bu bayrak yalnız kota ve
 * erişimi etkiler. Gizli değer yazdırmaz; yalnız kullanıcı kimliği ve sonuç durumu.
 *
 * Kullanım:
 *   pnpm tsx scripts/grant-tester.ts <email> [--create]   # yoksa e-postası onaylı hesap açar (parolasız)
 *   pnpm tsx scripts/grant-tester.ts <email> --revoke     # aboneliği "canceled" yapar, sınırsız kotayı kapatır
 */
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isMain } from "./engine-tooling";

/** Süresiz test aboneliğinin bitişi (uzak bir tarih; isPremium dönem sonuna bakar). */
export const COMP_PERIOD_END = "2099-12-31T23:59:59.000Z";
export const COMP_PROVIDER = "comp";

export type CompSubscriptionRow = {
  user_id: string;
  provider: typeof COMP_PROVIDER;
  plan: "monthly";
  status: "active" | "canceled";
  provider_subscription_ref: null;
  provider_customer_ref: null;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  updated_at: string;
};

/** Saf satır kurucu: grant → aktif, süresiz; revoke → iptal, dönem şimdi biter. */
export function compSubscriptionRow(userId: string, mode: "grant" | "revoke", now: Date = new Date()): CompSubscriptionRow {
  const iso = now.toISOString();
  return {
    user_id: userId,
    provider: COMP_PROVIDER,
    plan: "monthly",
    status: mode === "grant" ? "active" : "canceled",
    provider_subscription_ref: null,
    provider_customer_ref: null,
    current_period_start: iso,
    current_period_end: mode === "grant" ? COMP_PERIOD_END : iso,
    cancel_at_period_end: mode === "revoke",
    updated_at: iso,
  };
}

export function parseArgs(args: string[]): { email: string; create: boolean; revoke: boolean } | null {
  const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return { email, create: args.includes("--create"), revoke: args.includes("--revoke") };
}

async function findUserId(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Kullanıcı listesi okunamadı: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (!parsed) {
    console.log("Kullanım: grant-tester.ts <email> [--create] [--revoke]");
    process.exitCode = 1;
    return;
  }
  loadEnvConfig(process.cwd());
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli (.env.local).");
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let userId = await findUserId(admin, parsed.email);
  if (!userId) {
    if (!parsed.create || parsed.revoke) throw new Error("Bu e-postayla hesap yok. Açmak için --create ekle.");
    const { data, error } = await admin.auth.admin.createUser({ email: parsed.email, email_confirm: true });
    if (error || !data.user) throw new Error(`Hesap açılamadı: ${error?.message ?? "bilinmiyor"}`);
    userId = data.user.id;
    console.log("hesap açıldı (e-posta onaylı, parolasız; giriş e-posta koduyla)");
  }

  const mode = parsed.revoke ? "revoke" : "grant";
  const sub = await admin.from("subscriptions").upsert(compSubscriptionRow(userId, mode), { onConflict: "user_id" });
  if (sub.error) throw new Error(`Abonelik yazılamadı: ${sub.error.message}`);
  // Profil satırı kayıt tetikleyicisiyle oluşur; yoksa (eski hesap) yine de yazmayı dener.
  const prof = await admin.from("profiles").update({ unlimited_quota: mode === "grant" }).eq("id", userId).select("id");
  if (prof.error) throw new Error(`Profil güncellenemedi: ${prof.error.message}`);

  const check = await admin.from("subscriptions").select("plan, status, provider, current_period_end").eq("user_id", userId).maybeSingle();
  const quota = await admin.from("profiles").select("unlimited_quota").eq("id", userId).maybeSingle();
  console.log(JSON.stringify({ userId, mode, subscription: check.data, unlimitedQuota: quota.data?.unlimited_quota ?? null, profileRows: prof.data?.length ?? 0 }));
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : "hata");
    process.exit(1);
  });
}
