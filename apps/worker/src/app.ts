/**
 * Uygulama kurulumu: havuz, pg-boss, kuyruklar, işçiler, zamanlayıcı, sağlık sunucusu.
 * Test ve entegrasyon için bağımlılıklar (`overrides`) değiştirilebilir.
 */
import { createGateway, PgLedger, type Gateway } from '@ogrenmen/llm';
import { PgBoss, type Job, type JobResult, type Queue } from 'pg-boss';
import { describeConfig, type WorkerConfig } from './config.js';
import { createPool, pingDb, type Db, type DbPool } from './db.js';
import { createHealthServer, type HealthServer } from './health.js';
import { DEAD_LETTER_QUEUE, JOBS, jobsForProcess, validateRegistry } from './jobs/registry.js';
import { PermanentJobError } from './jobs/errors.js';
import type { AnyJobDefinition, JobContext, JobDeps, QueuePolicy } from './jobs/types.js';
import { createLogger, errorFields, type Logger } from './log.js';
import { PdfRenderer, type PdfRendererLike } from './pdf/render.js';
import { UNCONFIGURED_PUSH, WebPushSender, type PushSender } from './push.js';
import { installSchedules, planSchedules, removeSchedules } from './schedules.js';
import { createStorage, type StorageLike } from './storage.js';

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

  const enqueue: JobDeps['enqueue'] = async (name, data, opts) => boss.send(name, data, { ...(opts?.startAfter !== undefined ? { startAfter: opts.startAfter } : {}), ...(opts?.singletonKey ? { singletonKey: opts.singletonKey } : {}) });

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
  const health = createHealthServer({
    host: config.healthHost,
    port: config.healthPort,
    check: async () => {
      const dbOk = await pingDb(db);
      const ok = dbOk && started && !shuttingDown;
      return { ok, details: { process: config.process, db: dbOk, started, shuttingDown, uptimeSec: Math.round(process.uptime()) } };
    },
  });

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
    await boss.start({ attempts: 5 });
    await ensureQueue(boss, DEAD_LETTER_QUEUE, { retentionSeconds: 30 * 86_400, deleteAfterSeconds: 30 * 86_400 });
    // Tüm kuyruklar her süreçte açılır (SQL tarafı enqueue_job iş ekleyebilsin); işçiyi yalnız sahibi süreç bağlar.
    for (const def of JOBS) await ensureQueue(boss, def.name, queueOptions(def.retry, DEAD_LETTER_QUEUE));

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

    started = true;
    app.healthPort = await health.listen();
    log.info('işçi hazır', { ...describeConfig(config), healthPort: app.healthPort, workers: mine.map((d) => d.name) });
  }

  async function stop(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
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

  const app: App = { boss, db, health, healthPort: config.healthPort, start, stop, enqueue };
  return app;
}
