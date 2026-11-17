import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase';
import type { RpcClient } from './rpc';

/**
 * Kullanıcının JWT'siyle çalışan istemci (RLS ve RPC yetki denetimleri geçerli; service_role yok). P1 RPC'leri
 * src/lib/supabase/types.ts'te tiplenmediğinden yapısal RpcClient olarak döner; yanıtlar types.ts'teki zod
 * şemalarıyla ayrıştırılır.
 */
export async function studentDb(): Promise<RpcClient> {
  return (await createSupabaseServerClient()) as unknown as RpcClient;
}
