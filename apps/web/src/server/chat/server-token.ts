/**
 * Koç sunucu jetonu (supabase/migrations/0028_coach_rpcs.sql `app.coach_server_ok`): model çıktısını, defteri, hafıza
 * yazımını ve eğitmen yönlendirmesini yalnız web sunucusunun yazabildiğini kanıtlar. Öğrencinin JWT'si tarayıcıda da
 * vardır ve PostgREST'e doğrudan gidebilir; jeton ise yalnız sunucunun ortamındaki anahtarla (OGRENMEN_WEB_COACH_KEY,
 * `secure.server_keys` 'web_coach' satırının değeri) üretilir ve tarayıcıya hiç gitmez.
 *
 * Biçim: `v1.<bitiş unix sn>.<hex hmac_sha256(anahtar, "coach:<sohbet>:<bitiş>")>`; sohbete bağlı, DB en çok 1 saat kabul eder.
 * Saf modül (testler); `server-only` çağıranlardadır.
 */
import { createHmac } from 'node:crypto';

export const COACH_KEY_ENV = 'OGRENMEN_WEB_COACH_KEY';
/** Jetonun ömrü (sn). DB üst sınırı 3600; tur en çok 120 sn sürer. */
export const SERVER_TOKEN_TTL_S = 15 * 60;

/** Anahtar biçimi: göçün ürettiği 64 hex (32 bayt); en az 32 karakter kabul edilir (DB CHECK ile aynı). */
export function isCoachKey(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{32,}$/i.test(v);
}

export function mintServerToken(key: string, conversationId: string, now: Date = new Date(), ttlS: number = SERVER_TOKEN_TTL_S): string {
  const exp = String(Math.floor(now.getTime() / 1000) + ttlS);
  const mac = createHmac('sha256', key).update(`coach:${conversationId}:${exp}`, 'utf8').digest('hex');
  return `v1.${exp}.${mac}`;
}
