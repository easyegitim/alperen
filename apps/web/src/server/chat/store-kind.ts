import { ChatError } from './turn';

export type StoreKind = 'memory' | 'pg' | null;

/** Koçun sunucu Postgres bağlantısı (yalnız koç; depo genelindeki yönetici adresi `OGRENMEN_DATABASE_URL` DEĞİL). */
export const COACH_DB_ENV = 'OGRENMEN_WEB_COACH_DATABASE_URL';
/** RLS'i aşan rolle güvenilir yolu yalnız yerelde açan bayrak (üretimde yok sayılır; bkz. deps.ts checkDbRole). */
export const COACH_TRUSTED_DEV_ENV = 'OGRENMEN_WEB_COACH_TRUSTED_DEV';

/**
 * Hangi depo kullanılır (saf; testler). Sahte LLM olmadan bellek deposu reddedilir (gerçek veriyle karışmasın).
 * Depo genelindeki `OGRENMEN_DATABASE_URL` (kurucunun tam yetkili adresi; yedek ve test betikleri) bilerek okunmaz:
 * web ortamına kopyalansa bile koç onunla açılmaz.
 */
export function storeKindFor(env: Record<string, string | undefined>): StoreKind {
  if (env.OGRENMEN_CHAT_STORE === 'memory') {
    if (env.OGRENMEN_LLM !== 'fake') throw new ChatError('misconfigured', 503, 'Koç yapılandırması geçersiz.');
    return 'memory';
  }
  return env[COACH_DB_ENV] ? 'pg' : null;
}
