/** Tarayıcıya da açık Supabase değerleri (publishable key). Service-role anahtarı burada DEĞİL (bkz. admin.ts). */
export function getPublicSupabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase yapılandırması eksik: NEXT_PUBLIC_SUPABASE_URL ve NEXT_PUBLIC_SUPABASE_ANON_KEY gerekli.");
  }
  return { url, key };
}
