/**
 * Ortam değişkenlerinden işçi yapılandırması. Sır değerleri (servis anahtarı, VAPID özel anahtarı, veritabanı parolası)
 * yalnız bellekte tutulur; günlüğe yazılmaz (bkz. `describeConfig`).
 */
export type WorkerProcess = 'worker' | 'pdf' | 'all';
export type ScheduleMode = 'auto' | 'on' | 'off';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
/** Başlangıç denetimleri (`src/startup-checks.ts`): `strict` düşerse çıkış 78, `warn` sağlık 'degraded' ile sürer, `off` kapalı. */
export type StartupCheckMode = 'strict' | 'warn' | 'off';
/** `auto`: enqueue_job sahibinin pgboss yetkisi eksikse ve bağlantı rolü verebiliyorsa verir; `off`: yalnız denetler. */
export type PgbossGrantMode = 'auto' | 'off';
/**
 * Belge figürleri: `auto` (varsayılan: gerçek anahtarla code_execution, sahte LLM'de yerel), `code_execution` (Anthropic
 * konteyneri, Files API) ya da `local` (OS yalıtımında python3 -I matplotlib; yalnız açıkça istenirse).
 */
export type FiguresMode = 'auto' | 'code_execution' | 'local';

export interface WorkerConfig {
  /** Çalışan süreç: `worker` (genel işler + zamanlayıcı), `pdf` (yalnız pdf.render), `all` (yerel geliştirme). */
  process: WorkerProcess;
  databaseUrl: string;
  /** pg-boss şeması. */
  bossSchema: string;
  /** pg-boss havuzu en çok bağlantı (uygulama havuzundan ayrı). */
  bossPoolMax: number;
  /** Uygulama havuzu en çok bağlantı. */
  dbPoolMax: number;
  healthHost: string;
  healthPort: number;
  /** `auto`: runtime_flags.cron_owner = 'pg_cron' ise zamanlama kurulmaz. */
  schedules: ScheduleMode;
  logLevel: LogLevel;
  supabaseUrl: string | null;
  supabaseServiceKey: string | null;
  documentsBucket: string;
  vapid: { publicKey: string; privateKey: string; subject: string } | null;
  pdfChromiumPath: string | null;
  pdfConcurrency: number;
  /** Kapanışta süren işlere tanınan süre (ms). */
  shutdownTimeoutMs: number;
  startupChecks: StartupCheckMode;
  pgbossGrant: PgbossGrantMode;
  /** Denetim düşünce çıkıştan önce sağlığın 'degraded' göründüğü süre (ms). */
  startupExitDelayMs: number;
  /** secure.job_outbox → pg-boss aktarım aralığı (ms; `outbox.drain`). 0: zamanlayıcı kapalı (iş elle atılabilir). */
  outboxDrainIntervalMs: number;
  /** OGRENMEN_FIGURES (varsayılan auto). */
  figures: FiguresMode;
}

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function str(env: Env, key: string): string | null {
  const v = env[key];
  return v === undefined || v.trim() === '' ? null : v.trim();
}

function int(env: Env, key: string, def: number, min: number, max: number): number {
  const raw = str(env, key);
  if (raw === null) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${key} ${min}..${max} arasında tam sayı olmalı (verilen: ${raw})`);
  return n;
}

function oneOf<T extends string>(env: Env, key: string, allowed: readonly T[], def: T): T {
  const raw = str(env, key);
  if (raw === null) return def;
  if (!(allowed as readonly string[]).includes(raw)) throw new ConfigError(`${key} şunlardan biri olmalı: ${allowed.join(' | ')} (verilen: ${raw})`);
  return raw as T;
}

/** `--process=pdf` ya da `--process pdf` komut satırı bağımsız değişkeni (Fly processes bölümü). */
export function processFromArgv(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a.startsWith('--process=')) return a.slice('--process='.length);
    if (a === '--process') return argv[i + 1] ?? null;
  }
  return null;
}

export function loadConfig(env: Env = process.env, argv: readonly string[] = process.argv.slice(2)): WorkerConfig {
  const databaseUrl = str(env, 'DATABASE_URL');
  if (!databaseUrl) throw new ConfigError('DATABASE_URL tanımlı değil (service role bağlantı adresi; bkz. .env.example)');

  const procRaw = processFromArgv(argv) ?? str(env, 'WORKER_PROCESS') ?? 'all';
  if (!['worker', 'pdf', 'all'].includes(procRaw)) throw new ConfigError(`süreç adı worker | pdf | all olmalı (verilen: ${procRaw})`);

  const vapidPublic = str(env, 'VAPID_PUBLIC_KEY');
  const vapidPrivate = str(env, 'VAPID_PRIVATE_KEY');
  const vapidSubject = str(env, 'VAPID_SUBJECT');
  if ((vapidPublic || vapidPrivate) && !(vapidPublic && vapidPrivate && vapidSubject)) {
    throw new ConfigError('VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY ve VAPID_SUBJECT birlikte verilmeli');
  }

  const schema = str(env, 'PGBOSS_SCHEMA') ?? 'pgboss';
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new ConfigError(`PGBOSS_SCHEMA geçersiz: ${schema}`);
  // SQL tarafındaki public.enqueue_job() şemayı 'pgboss' olarak sabit kullanır; üretimde başka şema işleri sessizce kaybeder.
  if (str(env, 'NODE_ENV') === 'production' && schema !== 'pgboss') throw new ConfigError(`PGBOSS_SCHEMA üretimde 'pgboss' olmalı (SQL enqueue_job yalnız bu şemada çalışır; verilen: ${schema})`);

  return {
    process: procRaw as WorkerProcess,
    databaseUrl,
    bossSchema: schema,
    bossPoolMax: int(env, 'PGBOSS_POOL_MAX', 8, 2, 100),
    dbPoolMax: int(env, 'DB_POOL_MAX', 8, 1, 100),
    healthHost: str(env, 'HEALTH_HOST') ?? '0.0.0.0',
    healthPort: int(env, 'HEALTH_PORT', int(env, 'PORT', 8080, 0, 65535), 0, 65535),
    schedules: oneOf(env, 'WORKER_SCHEDULES', ['auto', 'on', 'off'] as const, 'auto'),
    logLevel: oneOf(env, 'LOG_LEVEL', ['debug', 'info', 'warn', 'error'] as const, 'info'),
    supabaseUrl: str(env, 'SUPABASE_URL'),
    supabaseServiceKey: str(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    documentsBucket: str(env, 'STORAGE_BUCKET_DOCUMENTS') ?? 'documents',
    vapid: vapidPublic && vapidPrivate && vapidSubject ? { publicKey: vapidPublic, privateKey: vapidPrivate, subject: vapidSubject } : null,
    pdfChromiumPath: str(env, 'PDF_CHROMIUM_PATH'),
    pdfConcurrency: int(env, 'PDF_CONCURRENCY', 2, 1, 16),
    shutdownTimeoutMs: int(env, 'SHUTDOWN_TIMEOUT_MS', 30_000, 1_000, 600_000),
    startupChecks: oneOf(env, 'WORKER_STARTUP_CHECKS', ['strict', 'warn', 'off'] as const, 'strict'),
    pgbossGrant: oneOf(env, 'WORKER_PGBOSS_GRANT', ['auto', 'off'] as const, 'auto'),
    startupExitDelayMs: int(env, 'WORKER_STARTUP_EXIT_DELAY_MS', 2_000, 0, 60_000),
    outboxDrainIntervalMs: int(env, 'OUTBOX_DRAIN_INTERVAL_MS', 30_000, 0, 3_600_000),
    figures: oneOf(env, 'OGRENMEN_FIGURES', ['auto', 'code_execution', 'local'] as const, 'auto'),
  };
}

/** Günlüğe yazılabilir özet: sırlar yok. */
export function describeConfig(c: WorkerConfig): Record<string, unknown> {
  let dbHost = '?';
  try {
    const u = new URL(c.databaseUrl);
    dbHost = `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    /* adres URL değil: ana makine bilgisi yazılmaz */
  }
  return {
    process: c.process,
    db: dbHost,
    bossSchema: c.bossSchema,
    health: `${c.healthHost}:${c.healthPort}`,
    schedules: c.schedules,
    llm: process.env.OGRENMEN_LLM === 'fake' ? 'fake' : 'anthropic',
    storage: c.supabaseUrl && c.supabaseServiceKey ? 'supabase' : 'kapalı',
    push: c.vapid ? 'vapid' : 'kapalı',
    pdfConcurrency: c.pdfConcurrency,
    startupChecks: c.startupChecks,
    pgbossGrant: c.pgbossGrant,
    outboxDrainMs: c.outboxDrainIntervalMs,
    figures: c.figures,
  };
}
