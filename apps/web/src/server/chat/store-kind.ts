import { ChatError } from './turn';
import { COACH_KEY_ENV, isCoachKey } from './server-token';

export type StoreKind = 'memory' | 'supabase' | null;

/** Eski güvenilir Postgres yolunun ortam değişkenleri (0028 ile kaldırıldı; tanımlıysa uyarılır, okunmaz). */
export const RETIRED_COACH_ENV = ['OGRENMEN_WEB_COACH_DATABASE_URL', 'OGRENMEN_WEB_COACH_TRUSTED_DEV'] as const;

/**
 * Hangi depo kullanılır (saf; testler). Sahte LLM olmadan bellek deposu reddedilir (gerçek veriyle karışmasın).
 * Üretim deposu yalnız kullanıcının JWT'siyle çalışır; tek gereksinimi sunucu anahtarıdır (OGRENMEN_WEB_COACH_KEY):
 * anahtar yoksa koç kapalıdır (model çıktısı ve defter yazılamaz). Anahtar biçimsizse 503 (yanlış yapılandırma).
 * Veritabanı adresleri (OGRENMEN_DATABASE_URL, eski OGRENMEN_WEB_COACH_DATABASE_URL) bilerek okunmaz.
 */
export function storeKindFor(env: Record<string, string | undefined>): StoreKind {
  if (env.OGRENMEN_CHAT_STORE === 'memory') {
    if (env.OGRENMEN_LLM !== 'fake') throw new ChatError('misconfigured', 503, 'Koç yapılandırması geçersiz.');
    return 'memory';
  }
  const key = env[COACH_KEY_ENV];
  if (!key) return null;
  if (!isCoachKey(key)) throw new ChatError('misconfigured', 503, 'Koç yapılandırması geçersiz.');
  return 'supabase';
}
