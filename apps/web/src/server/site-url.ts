import 'server-only';
import { headers } from 'next/headers';

/** Üretimde NEXT_PUBLIC_SITE_URL tanımlı mı (sağlık ucu da bunu bildirir). */
export function isSiteUrlConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SITE_URL);
}

/**
 * Uygulamanın dışarıdan görünen adresi (e-posta bağlantısı ve OAuth dönüşü için).
 * NEXT_PUBLIC_SITE_URL öncelikli. Üretimde zorunludur: ana makine başlığı istemci denetimindedir, bu yüzden
 * yalnız geliştirmede başlıklardan türetilir (başlık enjeksiyonuyla e-posta bağlantısının başka köke gitmesini önler).
 */
export async function getSiteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('NEXT_PUBLIC_SITE_URL üretimde tanımlı olmalı (apps/web/.env.example).');
  }
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}
