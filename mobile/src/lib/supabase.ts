import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import { env, isSupabaseConfigured } from "./env";
import { createChunkedStore } from "./secureStorage";

let client: SupabaseClient | null = null;

// PKCE (OAuth bağlama) için rastgele değer üretimi: Hermes'te crypto.getRandomValues olmayabilir.
const g = globalThis as { crypto?: { getRandomValues?: unknown } };
if (!g.crypto?.getRandomValues) {
  g.crypto = { ...(g.crypto ?? {}), getRandomValues: Crypto.getRandomValues };
}

/**
 * Mobil Supabase istemcisi (SPEC-MOBILE M2). Oturum SecureStore'da; URL'den oturum algılama kapalı
 * (deep link akışı M4'te ayrıca ele alınır). Uygulama öne gelince token yenileme çalışır.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  if (!isSupabaseConfigured) throw new Error("Supabase yapılandırması eksik: EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY");
  client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      storage: createChunkedStore(SecureStore),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // OAuth bağlama (Google/Apple) tarayıcıdan "aura://auth/callback?code=…" ile döner; kod sunucuda oturuma çevrilir.
      flowType: "pkce",
    },
  });
  AppState.addEventListener("change", (state) => {
    if (!client) return;
    if (state === "active") client.auth.startAutoRefresh();
    else client.auth.stopAutoRefresh();
  });
  return client;
}
