import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { parseBearer } from "@/lib/api/bearer";
import { getPublicSupabaseEnv } from "./env";

/**
 * Sunucu bileşenleri, route handler'lar ve server action'lar için istemci.
 * Oturum yenileme proxy.ts'te yapılır; Server Component içinde çerez yazılamazsa sessizce geçilir.
 */
export async function createClient(): Promise<SupabaseClient> {
  // Önce cookies(): route dinamik olur, prerender'da yapılandırma hatası fırlatılmaz.
  const cookieStore = await cookies();
  const { url, key } = getPublicSupabaseEnv();

  // SPEC-MOBILE M2: mobil istemci "Authorization: Bearer" gönderir; çerez yok. Token PostgREST'e
  // aynen iletilir (RLS kullanıcı JWT'siyle çalışır); kullanıcı çözümü auth.getUser(token) ile yapılır.
  const bearer = parseBearer((await headers()).get("authorization"));
  if (bearer) {
    return createSupabaseClient(url, key, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component'ten çağrıldı; proxy.ts oturumu zaten yeniliyor.
        }
      },
    },
  });
}
