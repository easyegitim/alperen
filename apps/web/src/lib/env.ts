// Ortam değişkenleri. NEXT_PUBLIC_* değerleri derleme sırasında satır içine alınır; bu yüzden doğrudan
// `process.env.NEXT_PUBLIC_X` biçiminde okunmalıdır (dinamik erişim istemcide boş döner).

export interface PublicEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  siteUrl: string | null;
  vapidPublicKey: string | null;
}

export function getPublicEnv(): PublicEnv {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL ve NEXT_PUBLIC_SUPABASE_ANON_KEY tanımlı olmalı (apps/web/.env.example dosyasına bak).');
  }
  return {
    supabaseUrl,
    supabaseAnonKey,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || null,
    vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null,
  };
}

/** Supabase yapılandırıldı mı (sağlık ucu ve yapılandırma ipuçları için; hata fırlatmaz). */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
