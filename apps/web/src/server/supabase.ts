import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getPublicEnv } from '@/lib/env';
import type { Database } from '@/lib/supabase/types';

/**
 * Sunucu bileşenleri, sunucu eylemleri ve rota işleyicileri için Supabase istemcisi (kullanıcının JWT'si ile; RLS geçerlidir).
 * Her istekte yeni istemci üretilir. Sunucu bileşeni çerez yazamaz; token yenilemesini proxy.ts yapar, bu yüzden
 * setAll'daki hata yutulur (eylem ve rota işleyicilerinde yazma çalışır).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();
  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          /* Sunucu bileşeninden çağrıldı: yenileme proxy.ts'te yapılır. */
        }
      },
    },
  });
}
