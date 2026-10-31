/**
 * Ortam değişkenleri ve gizli anahtarlar (BLUEPRINT §5.10).
 *
 * Worker'da imzalama gizi YOKTUR: veritabanı rolü `bot_runtime` JWT'si çevrimdışı basılır
 * (`SUPABASE_BOT_JWT`). Proje JWT gizi ya da hizmet rolü anahtarı ortamda görülürse boot bilerek
 * düşer — bu anahtarlar Worker'a hiç verilmemelidir.
 */

export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  WEBHOOK_SECRET_PATH?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_BOT_JWT?: string;
  GEMINI_PAID_KEY?: string;
  GEMINI_FREE_KEY?: string;
  GROQ_KEY?: string;
  OPENROUTER_KEY?: string;
  CF_AI_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  ADMIN_CHAT_ID?: string;
  PUBLIC_ENV?: string;
  PROMPT_VERSION_CHAT?: string;
  ADAPTERS?: string;
  DB?: string;
  TELEGRAM_API_BASE?: string;
  QUOTA_BYPASS_TELEGRAM_IDS?: string;
  LOG_LEVEL?: string;
  AI?: AiBinding;
  [key: string]: unknown;
}

export const WORKER_VERSION = '0.1.0';

/** Worker'da asla bulunmaması gereken değişken adları (bilerek boot hatası). */
const FORBIDDEN_ENV = [/^SUPABASE_SERVICE_ROLE/i, /^SUPABASE_JWT_SECRET$/i]; // anahtar yok: yalnız adla reddedilir

export class ConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code} ${message}`);
    this.code = code;
    this.name = 'ConfigError';
  }
}

export interface AppConfig {
  publicEnv: string;
  promptVersionChat: string;
  adaptersFake: boolean;
  dbFake: boolean;
  telegramApiBase: string;
  telegramToken: string;
  webhookSecret: string;
  webhookPath: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  botJwt: string;
  adminChatId: number | null;
  quotaBypass: ReadonlySet<number>;
  version: string;
}

const REQUIRED_REAL = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'WEBHOOK_SECRET_PATH'] as const;
const REQUIRED_SUPABASE = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_BOT_JWT'] as const;

function str(env: Env, key: string): string {
  const v = env[key];
  return typeof v === 'string' ? v.trim() : '';
}

/** Ortamı doğrular ve tipli yapılandırmaya çevirir. */
export function loadConfig(env: Env): AppConfig {
  for (const key of Object.keys(env)) {
    if (FORBIDDEN_ENV.some((re) => re.test(key))) {
      throw new ConfigError('OGR-ENV-001', `${key} Worker ortamında olamaz; bot_runtime JWT kullanılır`); // anahtar yok
    }
  }
  const adaptersFake = str(env, 'ADAPTERS') === 'fake';
  const dbFake = str(env, 'DB') === 'fake';
  const missing: string[] = [];
  for (const key of REQUIRED_REAL) if (str(env, key) === '') missing.push(key);
  if (!dbFake) for (const key of REQUIRED_SUPABASE) if (str(env, key) === '') missing.push(key);
  if (missing.length > 0) throw new ConfigError('OGR-ENV-002', `eksik gizli anahtar: ${missing.join(', ')}`);
  const admin = Number(str(env, 'ADMIN_CHAT_ID'));
  const bypass = new Set<number>();
  for (const part of str(env, 'QUOTA_BYPASS_TELEGRAM_IDS').split(',')) {
    const n = Number(part.trim());
    if (part.trim() !== '' && Number.isSafeInteger(n)) bypass.add(n);
  }
  return {
    publicEnv: str(env, 'PUBLIC_ENV') || 'local',
    promptVersionChat: str(env, 'PROMPT_VERSION_CHAT') || 'socratic.v3',
    adaptersFake,
    dbFake,
    telegramApiBase: (str(env, 'TELEGRAM_API_BASE') || 'https://api.telegram.org').replace(/\/+$/, ''),
    telegramToken: str(env, 'TELEGRAM_BOT_TOKEN'),
    webhookSecret: str(env, 'TELEGRAM_WEBHOOK_SECRET'),
    webhookPath: str(env, 'WEBHOOK_SECRET_PATH'),
    supabaseUrl: str(env, 'SUPABASE_URL').replace(/\/+$/, ''),
    supabaseAnonKey: str(env, 'SUPABASE_ANON_KEY'),
    botJwt: str(env, 'SUPABASE_BOT_JWT'),
    adminChatId: Number.isSafeInteger(admin) && admin !== 0 ? admin : null,
    quotaBypass: bypass,
    version: WORKER_VERSION,
  };
}

/** JWT `exp` alanından kalan gün (imza doğrulanmaz; yalnız /health uyarısı için). */
export function jwtDaysLeft(jwt: string, now: Date): number | null {
  const parts = jwt.split('.');
  if (parts.length !== 3 || parts[1] === undefined) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { exp?: unknown };
    if (typeof json.exp !== 'number') return null;
    return Math.floor((json.exp * 1000 - now.getTime()) / 86_400_000);
  } catch {
    return null;
  }
}
