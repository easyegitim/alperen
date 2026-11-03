/**
 * Uygulama kurulumu: havuz, pg-boss, kuyruklar, işçiler, zamanlayıcı, sağlık sunucusu.
 * Test ve entegrasyon için bağımlılıklar (`overrides`) değiştirilebilir.
 */
import { createGateway, PgLedger, type Gateway } from '@ogrenmen/llm';
import { PgBoss, type Job, type JobResult, type Queue } from 'pg-boss';
import { describeConfig, type WorkerConfig } from './config.js';
import { createPool, pingDb, type Db, type DbPool } from './db.js';
import { createHealthServer, type HealthServer } from './health.js';
import { DEAD_LETTER_QUEUE, JOBS, getJob, jobNames, jobsForProcess, validateRegistry } from './jobs/registry.js';
import { syncPromptVersions } from '@ogrenmen/prompts/db';
import { PermanentJobError } from './jobs/errors.js';
import type { AnyJobDefinition, JobContext, JobDeps, QueuePolicy } from './jobs/types.js';
import { createLogger, errorFields, type Logger } from './log.js';
import { PdfRenderer, type PdfRendererLike } from './pdf/render.js';
import { UNCONFIGURED_PUSH, WebPushSender, type PushSender } from './push.js';
import { installSchedules, planSchedules, removeSchedules } from './schedules.js';
import { createStorage, type StorageLike } from './storage.js';
import { drainOutbox, type OutboxDrainResult, type TxDb, type TxPool } from './outbox.js';
import {
  checkOutbox,
  failures,
  preflightPgboss,
  PROBE_QUEUE,
  REQUIRED_QUEUES,
  runStartupChecks,
  StartupCheckError,
  summarize,
  type StartupReport,
} from './startup-checks.js';

export interface AppOverrides {
  log?: Logger;
  db?: DbPool;
  gateway?: () => Promise<Gateway>;
  storage?: StorageLike | null;
  pdf?: PdfRendererLike;
  push?: PushSender;
}

export interface App {
  boss: PgBoss;
  db: DbPool;
  health: HealthServer;
  /** Gerçek sağlık portu (start sonrası). */
  healthPort: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Bir iş ekler (kuyruk açık olmalı). */
  enqueue: JobDeps['enqueue'];
  /** Son başlangıç denetimi raporu (`src/startup-checks.ts`); denetim kapalıysa null. */
  startupReport(): StartupReport | null;
  /** secure.job_outbox → pg-boss aktarımı; outbox kullanılamıyorsa null. */
  drainOutbox: JobDeps['drainOutbox'] | null;
}

/** Deneme kuyruğu: satırlar geri alınır, kalırsa kısa sürede silinir. */
const PROBE_QUEUE_OPTIONS: Omit<Queue, 'name'> = { retryLimit: 0, retryDelay: 0, retryBackoff: false, expireInSeconds: 60, retentionSeconds: 3600, deleteAfterSeconds: 60 };

function hasConnect(db: unknown): db is TxPool {
  return typeof (db as { connect?: unknown } | null)?.connect === 'function';
}

function queueOptions(policy: QueuePolicy, deadLetter: string | undefined): Omit<Queue, 'name'> {
  return {
    retryLimit: policy.retryLimit,
    retryDelay: policy.retryDelay,
    retryBackoff: policy.retryBackoff,
    ...(policy.retryDelayMax !== undefined && policy.retryBackoff ? { retryDelayMax: policy.retryDelayMax } : {}),
    expireInSeconds: policy.expireInSeconds,
    ...(policy.retentionSeconds !== undefined ? { retentionSeconds: policy.retentionSeconds } : {}),
    ...(policy.deleteAfterSeconds !== undefined ? { deleteAfterSeconds: policy.deleteAfterSeconds } : {}),
    ...(deadLetter ? { deadLetter } : {}),
  };
}

/** Kuyruğu yoksa açar, varsa seçenekleri günceller. */
async function ensureQueue(boss: PgBoss, name: string, opts: Omit<Queue, 'name'>): Promise<void> {
  if (await boss.getQueue(name)) {
    const { deadLetter, retryDelayMax, ...rest } = opts;
    await boss.updateQueue(name, { ...rest, deadLetter: deadLetter ?? null, retryDelayMax: retryDelayMax ?? null });
  } else {
    await boss.createQueue(name, opts);
  }
}

export function createApp(config: WorkerConfig, overrides: AppOverrides = {}): App {
  const log = overrides.log ?? createLogger(config.logLevel, { process: config.process });
  const problems = validateRegistry();
  if (problems.length > 0) throw new Error(`iş kayıt defteri geçersiz: ${problems.join('; ')}`);

  const db = overrides.db ?? createPool({ databaseUrl: config.databaseUrl, max: config.dbPoolMax });
  const runsSchedules = config.process !== 'pdf';
  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    schema: config.bossSchema,
    max: config.bossPoolMax,
    application_name: `ogrenmen-worker-${config.process}`,
    schedule: runsSchedules,
  });
  boss.on('error', (err) => log.error('pg-boss hatası', errorFields(err)));

  const pdf = overrides.pdf ?? new PdfRenderer({ executablePath: config.pdfChromiumPath, maxConcurrent: config.pdfConcurrency });
  const push = overrides.push ?? (config.vapid ? new WebPushSender(config.vapid) : UNCONFIGURED_PUSH);
  const storage = overrides.storage !== undefined ? overrides.storage : createStorage({ url: config.supabaseUrl, serviceKey: config.supabaseServiceKey });

  let gatewayPromise: Promise<Gateway> | null = null;
  const gateway = overrides.gateway
    ? overrides.gateway
    : () => {
        if (!gatewayPromise) {
          if (process.env.OGRENMEN_LLM !== 'fake' && !process.env.ANTHROPIC_API_KEY) {
            return Promise.reject(new PermanentJobError('ANTHROPIC_API_KEY tanımlı değil (ya da OGRENMEN_LLM=fake)', 'OGR-JOB-103'));
          }
          gatewayPromise = createGateway({ ledger: new PgLedger(db) });
        }
        return gatewayPromise;
      };

  const enqueue: JobDeps['enqueue'] = async (name, data, opts) =>
    boss.send(name, data, {
      ...(opts?.startAfter !== undefined ? { startAfter: opts.startAfter } : {}),
      ...(opts?.singletonKey ? { singletonKey: opts.singletonKey } : {}),
      ...(opts?.singletonSeconds ? { singletonSeconds: opts.singletonSeconds, singletonNextSlot: opts.debounce === true } : {}),
    });

  const deps: JobDeps = {
    config,
    log,
    db: db as Db,
    gateway,
    storage: () => {
      if (!storage) throw new PermanentJobError('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tanımlı değil', 'OGR-JOB-104');
      return storage;
    },
    pdf,
    push,
    enqueue,
    now: () => new Date(),
  };

  let shuttingDown = false;
  let started = false;
  let listening = false;
  let report: StartupReport | null = null;
  let drainTimer: NodeJS.Timeout | null = null;
  /** Son outbox aktarımının özeti (/healthz `outbox`). */
  let lastDrain: (Pick<OutboxDrainResult, 'pending' | 'oldestAgeSec' | 'stuck'> & { at: string }) | null = null;
  const health = createHealthServer({
    host: config.healthHost,
    port: config.healthPort,
    check: async () => {
      const dbOk = await pingDb(db);
      const degraded = report !== null && !report.ok;
      const ok = dbOk && started && !shuttingDown && !degraded;
      return {
        ok,
        ...(degraded ? { status: 'degraded' } : {}),
        details: {
          process: config.process,
          db: dbOk,
          started,
          shuttingDown,
          uptimeSec: Math.round(process.uptime()),
          ...(report ? { startupChecks: summarize(report) } : {}),
          ...(lastDrain ? { outbox: lastDrain } : {}),
        },
      };
    },
  });

  async function listenHealth(): Promise<void> {
    if (listening) return;
    app.healthPort = await health.listen();
    listening = true;
  }

  function enableOutbox(): void {
    if (!hasConnect(db)) {
      log.warn('outbox aktarımı kapalı: veritabanı havuzu işlem açamıyor (connect yok)');
      return;
    }
    const pool = db;
    deps.drainOutbox = async () => {
      const r = await drainOutbox({
        pool,
        send: (name, data, id, tx: TxDb) => boss.send(name, data, { id, db: tx }),
        queueExists: async (name) => (await boss.getQueue(name)) !== null,
        log,
      });
      lastDrain = { pending: r.pending, oldestAgeSec: r.oldestAgeSec, stuck: r.stuck, at: new Date().toISOString() };
      return r;
    };
    app.drainOutbox = deps.drainOutbox;
  }

  /** Denetim düştü: strict ise hata (index.ts 78 ile çıkar), warn ise sağlık 'degraded' ile sürer. */
  function onFailedChecks(r: StartupReport): void {
    report = r;
    const failed = failures(r);
    log.error('başlangıç denetimi düştü', { mode: config.startupChecks, failed: failed.map((c) => `${c.name}: ${c.detail}`) });
    if (config.startupChecks === 'strict') throw new StartupCheckError(r);
  }

  async function runJob(def: AnyJobDefinition, job: Job<unknown>): Promise<JobResult> {
    const jlog = log.child({ job: def.name, jobId: job.id, retry: job.retryCount });
    const t0 = Date.now();
    try {
      const parsed = def.payload.safeParse(job.data ?? {});
      if (!parsed.success) {
        jlog.error('geçersiz iş yükü', { issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
        return { id: job.id, status: 'deadletter', output: { error: 'geçersiz yük', code: 'OGR-JOB-100' } };
      }
      const ctx: JobContext = { ...deps, log: jlog, job: { id: job.id, name: def.name, retryCount: job.retryCount }, signal: job.signal };
      const output = await def.handler!(parsed.data, ctx);
      jlog.info('iş bitti', { ms: Date.now() - t0 });
      return { id: job.id, status: 'completed', output: output ?? null };
    } catch (err) {
      if (err instanceof PermanentJobError) {
        jlog.error('kalıcı iş hatası', { ms: Date.now() - t0, ...errorFields(err) });
        return { id: job.id, status: 'deadletter', output: { error: err.message, code: err.code } };
      }
      jlog.warn('iş hatası (yeniden denenebilir)', { ms: Date.now() - t0, ...errorFields(err) });
      throw err;
    }
  }

  async function start(): Promise<void> {
    // Sağlık sunucusu önce açılır: denetim düşerse 'degraded' çıkıştan önce görünür.
    await listenHealth();
    const checking = config.startupChecks !== 'off';
    const preflight = checking ? await preflightPgboss(db, config.bossSchema) : undefined;
    if (preflight?.status === 'fail') {
      // Ön denetim her kipte ölümcüldür: pg-boss şemasız/yetkisiz başlayamaz (warn kipi de sürdüremez); pg-boss'un
      // anlaşılmaz hatası (çıkış 1) yerine açık nedenle çıkış 78.
      const r: StartupReport = { ok: false, checks: [preflight], outbox: false };
      onFailedChecks(r);
      throw new StartupCheckError(r);
    }

    await boss.start({ attempts: 5 });
    await ensureQueue(boss, DEAD_LETTER_QUEUE, { retentionSeconds: 30 * 86_400, deleteAfterSeconds: 30 * 86_400 });
    // Tüm kuyruklar her süreçte açılır (SQL tarafı enqueue_job iş ekleyebilsin); işçiyi yalnız sahibi süreç bağlar.
    for (const def of JOBS) await ensureQueue(boss, def.name, queueOptions(def.retry, DEAD_LETTER_QUEUE));

    // Başlangıç denetimleri: (a) bağlantı rolü, (c) gerekli kuyruklar, (b) enqueue_job → pgboss.job denemesi, outbox.
    let outboxOk: boolean;
    if (checking) {
      const r = await runStartupChecks({
        db,
        schema: config.bossSchema,
        queues: [...REQUIRED_QUEUES, ...jobNames()],
        ops: {
          exists: async (name) => (await boss.getQueue(name)) !== null,
          create: async (name) => {
            const def = getJob(name);
            await ensureQueue(boss, name, def ? queueOptions(def.retry, DEAD_LETTER_QUEUE) : name === PROBE_QUEUE ? PROBE_QUEUE_OPTIONS : queueOptions({ retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 900 }, DEAD_LETTER_QUEUE));
          },
        },
        grant: config.pgbossGrant,
        log,
        ...(preflight ? { preflight } : {}),
      });
      if (r.ok) {
        report = r;
        log.info('başlangıç denetimleri geçti', { checks: summarize(r) });
      } else {
        onFailedChecks(r);
      }
      outboxOk = r.outbox;
    } else {
      const ob = await checkOutbox(db);
      outboxOk = ob.available;
      if (ob.status === 'fail') log.error('outbox aktarılamıyor; SQL işleri birikir (WORKER_STARTUP_CHECKS=off)', { detail: ob.detail });
      else if (!ob.available) log.warn('outbox', { detail: ob.detail });
    }
    if (outboxOk) enableOutbox();

    const mine = jobsForProcess(config.process).filter((d) => d.handler !== null);
    for (const def of mine) {
      const concurrency = typeof def.concurrency === 'function' ? def.concurrency(config) : def.concurrency;
      await boss.work<unknown, unknown>(
        def.name,
        { localConcurrency: concurrency, batchSize: 1, pollingIntervalSeconds: 2, perJobResults: true },
        async (jobs) => Promise.all(jobs.map((j) => runJob(def, j))),
      );
    }

    if (runsSchedules) {
      const plan = await planSchedules(config.schedules, db);
      if (plan.install) log.info('zamanlamalar kuruldu', { schedules: await installSchedules(boss), reason: plan.reason });
      else log.info('zamanlama kurulmadı; eski kayıtlar silindi', { reason: plan.reason, removed: await removeSchedules(boss) });
    }

    // Paketteki prompt sürümlerini prompt_versions'a yazar (active kaynağı, llm_calls.prompt_version bağı, metin sapması).
    try {
      const sync = await syncPromptVersions(db);
      log.info('prompt sürümleri eşlendi', { inserted: sync.inserted, unchanged: sync.unchanged.length });
      if (sync.drifted.length > 0) log.error('prompt metni yayımlanmış sürümden sapmış; yeni sürüm açılmalı', { drifted: sync.drifted });
    } catch (err) {
      log.error('prompt sürümleri eşlenemedi', errorFields(err));
    }

    // Outbox: açılışta bir kez doğrudan, sonra her aralıkta outbox.drain işi (singletonSeconds: kopyalar arasında tek iş).
    if (deps.drainOutbox && mine.some((d) => d.name === 'outbox.drain')) {
      await deps.drainOutbox().catch((err: unknown) => log.error('outbox ilk aktarımı düştü', errorFields(err)));
      if (config.outboxDrainIntervalMs > 0) {
        const seconds = Math.max(1, Math.floor(config.outboxDrainIntervalMs / 1000));
        drainTimer = setInterval(() => {
          if (shuttingDown) return;
          boss.send('outbox.drain', { reason: 'interval' }, { singletonKey: 'outbox.drain', singletonSeconds: seconds }).catch((err: unknown) => log.warn('outbox.drain kuyruğa atılamadı', errorFields(err)));
        }, config.outboxDrainIntervalMs);
        drainTimer.unref();
      }
    }

    started = true;
    await listenHealth();
    log.info('işçi hazır', { ...describeConfig(config), healthPort: app.healthPort, workers: mine.map((d) => d.name) });
  }

  async function stop(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    if (drainTimer) clearInterval(drainTimer);
    log.info('kapanış başladı');
    try {
      await boss.stop({ graceful: true, timeout: config.shutdownTimeoutMs, close: true });
    } catch (err) {
      log.error('pg-boss kapanışı', errorFields(err));
    }
    await pdf.close().catch(() => undefined);
    if (!overrides.db) await db.end().catch(() => undefined);
    await health.close();
    log.info('kapandı');
  }

  const app: App = { boss, db, health, healthPort: config.healthPort, start, stop, enqueue, startupReport: () => report, drainOutbox: null };
  return app;
}
