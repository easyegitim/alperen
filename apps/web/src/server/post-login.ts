import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decideRoute } from '@/lib/routing';
import { isAppRole } from '@/lib/roles';
import type { Database } from '@/lib/supabase/types';

/**
 * Girişten hemen sonra gidilecek yol: `next` yolu, kullanıcının rolüne göre proxy ile aynı kararla (decideRoute)
 * çözülür; böylece sunucu eyleminden tek yönlendirmeyle doğru sayfaya inilir (/ -> /ogrenci zinciri gerekmez).
 */
export async function resolvePostLoginPath(supabase: SupabaseClient<Database>, userId: string, next: string): Promise<string> {
  const { data: profile } = await supabase.from('profiles').select('role, onboarded_at').eq('id', userId).maybeSingle();
  const decision = decideRoute({
    pathname: next.split('?')[0] ?? '/',
    authed: true,
    role: profile && isAppRole(profile.role) ? profile.role : null,
    onboarded: Boolean(profile?.onboarded_at),
  });
  return decision.type === 'redirect' ? decision.to : next;
}
