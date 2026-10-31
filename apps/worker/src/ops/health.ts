/**
 * Sağlık denetimi (§5.1 `GET /health`, §5.9 keepalive): veritabanı (`ping()` RPC), `bot_runtime` JWT'sinin
 * kalan günü (< 14 gün → uyarı) ve sağlayıcı zinciri (anahtarı olan en az bir sağlayıcı).
 */
import { jwtDaysLeft } from '../env.ts';
import type { Services } from '../services.ts';

export const JWT_WARN_DAYS = 14;

export interface Health {
  ok: boolean;
  version: string;
  prompt_version: string;
  bot_jwt_days_left: number | null;
  db: 'ok' | 'down';
  chain: 'ok' | 'empty';
}

export async function checkHealth(s: Services): Promise<Health> {
  let db: 'ok' | 'down' = 'down';
  try {
    db = (await s.db.ping()) === 1 ? 'ok' : 'down';
  } catch {
    db = 'down';
  }
  const cfg = s.cfg;
  const days = cfg.botJwt === '' ? null : jwtDaysLeft(cfg.botJwt, s.now());
  // Sahte DB'de JWT yoksa denetim yapılmaz; JWT verildiyse (gerçek ya da test) her zaman denetlenir.
  const jwtOk = cfg.botJwt === '' ? cfg.dbFake : days !== null && days >= JWT_WARN_DAYS;
  const chain: 'ok' | 'empty' = cfg.adaptersFake || s.deps.llm.size > 0 ? 'ok' : 'empty';
  return { ok: db === 'ok' && jwtOk && chain === 'ok', version: cfg.version, prompt_version: cfg.promptVersionChat, bot_jwt_days_left: days, db, chain };
}

/** Kurucuya gidecek kısa operasyon satırları (yalnız sorunlu kalemler). */
export function healthProblems(h: Health): string[] {
  const out: string[] = [];
  if (h.db === 'down') out.push('veritabanı yanıt vermiyor');
  if (h.bot_jwt_days_left === null || h.bot_jwt_days_left < JWT_WARN_DAYS) out.push(h.bot_jwt_days_left === null ? 'bot JWT okunamadı' : `bot JWT ${h.bot_jwt_days_left} gün içinde bitiyor`);
  if (h.chain === 'empty') out.push('sağlayıcı zinciri boş');
  return out;
}
