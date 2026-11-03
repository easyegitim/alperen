import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/server/supabase';
import type { UploadDatabase } from './db-types';

export type UploadClient = SupabaseClient<UploadDatabase>;

/** Yükle/teşhis tipleriyle aynı oturumlu istemci (kullanıcının JWT'si; RLS geçerli; service_role yok). */
export async function uploadClient(): Promise<UploadClient> {
  return (await createSupabaseServerClient()) as unknown as UploadClient;
}
