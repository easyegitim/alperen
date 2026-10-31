/**
 * Yapılandırılmış log: JSON satırı `{lvl, evt, chat_hash, public_ref, ms, …}`. Ad, ham metin,
 * Telegram kimliği ve students.id loglanmaz (§5.10); sohbet kimliği yalnız sha256(chat_id)[:8].
 */
import { chatHash } from '../util.ts';

export interface LogFields {
  chat?: number;
  public_ref?: string | null;
  ms?: number;
  [key: string]: unknown;
}

const BLOCKED_KEYS = /^(display_name|text_raw|first_name|last_name|username|telegram_user_id|student_id|text)$/;

function line(lvl: 'info' | 'warn' | 'error', evt: string, f: LogFields): string {
  const out: Record<string, unknown> = { lvl, evt };
  if (f.chat !== undefined) out.chat_hash = chatHash(f.chat);
  for (const [k, v] of Object.entries(f)) {
    if (k === 'chat' || BLOCKED_KEYS.test(k)) continue;
    out[k] = v;
  }
  return JSON.stringify(out);
}

let infoEnabled = true;

/** LOG_LEVEL=warn ile bilgi satırları kapanır (testler). */
export function setLogLevel(level: string): void {
  infoEnabled = level !== 'warn' && level !== 'error';
}

export const log = {
  info(evt: string, f: LogFields = {}): void {
    if (infoEnabled) console.log(line('info', evt, f));
  },
  warn(evt: string, f: LogFields = {}): void {
    console.warn(line('warn', evt, f));
  },
  error(evt: string, f: LogFields = {}): void {
    console.error(line('error', evt, f));
  },
};

/**
 * En iyi çaba yazımı: hata loglanır, akış sürer. Kayıt bildirimi gibi zorunlu bir gönderimin önündeki
 * yan yazımlar (ops alarmı, sağlayıcı sağlığı) yetki ya da ağ hatasıyla akışı kesmesin (README not 11).
 */
export async function bestEffort(evt: string, p: Promise<unknown>, f: LogFields = {}): Promise<void> {
  try {
    await p;
  } catch (err) {
    log.warn(evt, { ...f, err: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
}
