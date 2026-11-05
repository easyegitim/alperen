import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getPublicEnv } from '../env';
import { isAppRole } from '../roles';
import type { Database } from './types';

export interface SessionSnapshot {
  response: NextResponse;
  userId: string | null;
  role: string | null;
  onboarded: boolean;
}

/**
 * proxy.ts için oturum yenileme. Çerezleri istek ve yanıta yazar (token yenilemesi), doğrulanmış kullanıcıyı ve
 * profil rolünü döndürür. getClaims() imzayı doğrular (asimetrik anahtarlarda ağ çağrısı yok); `getSession()` tek başına
 * sunucuda güvenilmez.
 */
export async function updateSession(request: NextRequest): Promise<SessionSnapshot> {
  let response = NextResponse.next({ request });
  const env = getPublicEnv();
  const supabase = createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Önbellek başlıkları: oturum çerezi içeren yanıt paylaşılan önbelleğe girmesin.
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === 'string' ? data.claims.sub : null;
  if (!userId) return { response, userId: null, role: null, onboarded: false };

  const { data: profile } = await supabase.from('profiles').select('role, onboarded_at').eq('id', userId).maybeSingle();
  const role = profile && isAppRole(profile.role) ? profile.role : null;
  return { response, userId, role, onboarded: Boolean(profile?.onboarded_at) };
}
