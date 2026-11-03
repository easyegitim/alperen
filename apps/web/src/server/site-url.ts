import 'server-only';
import { headers } from 'next/headers';

/**
 * Uygulamanın dışarıdan görünen adresi (e-posta bağlantısı ve OAuth dönüşü için).
 * NEXT_PUBLIC_SITE_URL öncelikli; yoksa vekil sunucu başlıklarından türetilir.
 */
export async function getSiteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}
