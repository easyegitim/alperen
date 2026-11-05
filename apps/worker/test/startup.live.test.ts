/**
 * Başlangıç denetimleri ve outbox canlı testi: geçici v2 veritabanı (`@ogrenmen/llm/testing`, içeriksiz) + gerçek pg-boss
 * (`pgboss` şeması). Akış:
 *   1. süper kullanıcı worker'ı açılır: denetimler geçer (enqueue_job sahibi ogrenmen_owner'a pgboss yetkisi verilir,
 *      `startup.probe` denemesi geri alınır), /healthz 200;
 *   2. sahibin pgboss.job yetkisi geri alınınca SQL'den atılan iş kaybolmaz: secure.job_outbox → `drainOutbox` aynı
 *      kimlikle pg-boss'a aktarır → noop işi tamamlanır; zamanlayıcı (OUTBOX_DRAIN_INTERVAL_MS) outbox.drain işini atar;
 *   3. WORKER_PGBOSS_GRANT=off ve yetkisiz sahip: start StartupCheckError (78) ile düşer, /healthz 503 'degraded';
 *   4. pgboss'ta yetkisiz bir giriş rolüyle gerçek süreç (`src/index.ts`) 78 ile çıkar ve nedeni yazar; aynı rolle
 *      WORKER_STARTUP_CHECKS=warn da ön denetimde StartupCheckError (78) verir (pg-boss'un anlaşılmaz hatası değil);
 *   5. secure.job_outbox'ta yetkili ama BYPASSRLS olmayan rol (FORCE RLS, politika yok → 0 satır görür) outbox
 *      denetiminde düşer; BYPASSRLS verilince bekleyen satırı görür.
 * OGRENMEN_LIVE=1 yoksa atlanır.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTempDatabase, MIGRATION_ROLE, type TempDatabase } from '@ogrenmen/llm/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/log.js';
import { checkOutbox, PROBE_QUEUE, StartupCheckError } from '../src/startup-checks.js';

const live = process.env.OGRENMEN_LIVE === '1';
const WORKER_DIR = fileURLToPath(new URL('..', import.meta.url));
const fakePdf = { render: async () => ({ pdf: Buffer.from('%PDF-1.4'), pages: 1, bytes: 8 }), close: async () => undefined };

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('beklenen durum oluşmadı');
    await new Promise((r) => setTimeout(r, 200));
  }
}

function withUser(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

describe.skipIf(!live)('başlangıç denetimleri ve outbox (gerçek pg-boss)', () => {
  let tmp: TempDatabase;
  let app: App | undefined;
  const role = `ogr_noboss_${randomBytes(3).toString('hex')}`;
  const outboxRole = `ogr_norls_${randomBytes(3).toString('hex')}`;
  const password = randomBytes(12).toString('hex');

  const cfg = (extra: Record<string, string> = {}) =>
    loadConfig(
      { DATABASE_URL: tmp.url, PGBOSS_SCHEMA: 'pgboss', HEALTH_HOST: '127.0.0.1', HEALTH_PORT: '0', WORKER_SCHEDULES: 'off', PDF_CONCURRENCY: '1', ...extra },
      ['--process=all'],
    );
  const revokeOwner = () => tmp.pool.query(`revoke insert on pgboss.job from ${MIGRATION_ROLE}`);

  beforeAll(async () => {
    tmp = await createTempDatabase({ content: false });
  }, 120_000);

  afterAll(async () => {
    await app?.stop().catch(() => undefined);
    await tmp?.drop();
    if (tmp) {
      const pg = (await import('pg')).default;
      const c = new pg.Client({ connectionString: process.env.OGRENMEN_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://ogrenmen:ogrenmen@127.0.0.1:5432/ogrenmen' });
      await c.connect();
      await c.query(`drop role if exists ${role}`).catch(() => undefined);
      await c.query(`drop role if exists ${outboxRole}`).catch(() => undefined);
      await c.end();
    }
  });

  it('denetimler geçer: sahip yetkilendirilir, deneme satırı geri alınır, sağlık 200', async () => {
    app = createApp(cfg({ OUTBOX_DRAIN_INTERVAL_MS: '1000' }), { log: silentLogger, db: tmp.pool, pdf: fakePdf });
    await app.start();
    const report = app.startupReport()!;
    expect(report.ok).toBe(true);
    const byName = Object.fromEntries(report.checks.map((c) => [c.name, c]));
    expect(byName['pgboss.preflight']?.status).toBe('ok');
    expect(byName['pgboss.role']?.status).toBe('ok');
    expect(['ok', 'fixed']).toContain(byName['pgboss.queues']?.status);
    // ogrenmen_owner pgboss'u kurmadı: worker (süper kullanıcı) yetkiyi verdi, deneme geçti
    expect(byName['enqueue_job']).toMatchObject({ status: 'fixed', detail: expect.stringContaining(MIGRATION_ROLE) });
    expect(byName['outbox']?.status).toBe('ok');
    expect(report.outbox).toBe(true);
    expect((await tmp.pool.query(`select count(*)::int as n from pgboss.job where name = $1`, [PROBE_QUEUE])).rows[0]!.n).toBe(0);
    expect((await tmp.pool.query(`select count(*)::int as n from secure.job_outbox`)).rows[0]!.n).toBe(0);
    for (const q of ['curriculum.draft', 'upload.intake', 'practice.prewarm', 'outbox.drain', PROBE_QUEUE]) expect(await app.boss.getQueue(q), q).toBeTruthy();
    const h = await fetch(`http://127.0.0.1:${app.healthPort}/healthz`);
    expect(h.status).toBe(200);
    const body = (await h.json()) as { status: string; startupChecks: Record<string, string> };
    expect(body.status).toBe('ok');
    expect(body.startupChecks.enqueue_job).toMatch(/^fixed/);
  });

  it("sahip yetkisizken SQL işi outbox'a düşer; outbox.drain aynı kimlikle pg-boss'a aktarır, iş tamamlanır", async () => {
    await revokeOwner();
    const id = (await tmp.pool.query(`select public.enqueue_job('noop', '{"echo":{"from":"outbox"}}') as id`)).rows[0]!.id;
    expect(id).toBeNull();
    const ob = (await tmp.pool.query(`select id::text, reason from secure.job_outbox where name = 'noop'`)).rows[0] as { id: string; reason: string };
    expect(ob.reason).toMatch(/permission denied|42501/);
    expect((await tmp.pool.query(`select count(*)::int as n from audit.events where action = 'job.enqueue_failed' and diff ->> 'outbox_id' = $1`, [ob.id])).rows[0]!.n).toBe(1);

    const r = await app!.drainOutbox!();
    expect(r).toMatchObject({ moved: 1, failed: 0, pending: 0 });
    const job = await waitFor(async () => {
      const [j] = await app!.boss.findJobs<{ echo: unknown }>('noop', { id: ob.id });
      return j?.state === 'completed' ? j : null;
    });
    expect(job.output).toMatchObject({ ok: true, echo: { from: 'outbox' } });

    // kuyruğu olmayan iş outbox'ta kalır ve denemesi sayılır; zamanlayıcının attığı outbox.drain işi geçerli satırı aktarır
    await tmp.pool.query(`select public.enqueue_job('yok.kuyruk', '{}')`);
    await tmp.pool.query(`insert into secure.job_outbox (name, data, reason) values ('noop', '{"echo":"zamanlayici"}', 'test')`);
    await waitFor(async () => (await tmp.pool.query(`select count(*)::int as n from secure.job_outbox where name = 'noop'`)).rows[0]!.n === 0, 15_000);
    const drains = await app!.boss.findJobs('outbox.drain', {});
    expect(drains.length).toBeGreaterThan(0);
    const stuck = (await tmp.pool.query(`select attempts, last_error from secure.job_outbox where name = 'yok.kuyruk'`)).rows[0] as { attempts: number; last_error: string };
    expect(stuck.attempts).toBeGreaterThanOrEqual(1);
    expect(stuck.last_error).toContain('kuyruk yok');
    await tmp.pool.query(`delete from secure.job_outbox`);
    await app!.stop();
    app = undefined;
  }, 60_000);

  it("WORKER_PGBOSS_GRANT=off ve yetkisiz sahip: start 78'lik hatayla düşer, sağlık 'degraded'", async () => {
    await revokeOwner();
    app = createApp(cfg({ WORKER_PGBOSS_GRANT: 'off', OUTBOX_DRAIN_INTERVAL_MS: '0' }), { log: silentLogger, db: tmp.pool, pdf: fakePdf });
    const err = await app.start().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StartupCheckError);
    expect((err as StartupCheckError).exitCode).toBe(78);
    expect((err as StartupCheckError).message).toContain(MIGRATION_ROLE);
    const h = await fetch(`http://127.0.0.1:${app.healthPort}/healthz`);
    expect(h.status).toBe(503);
    const body = (await h.json()) as { status: string; startupChecks: Record<string, string> };
    expect(body.status).toBe('degraded');
    expect(body.startupChecks.enqueue_job).toMatch(/^fail/);
    await app.stop();
    app = undefined;
  }, 60_000);

  it('pgboss şemasında yetkisiz rolle gerçek süreç 78 ile çıkar ve nedeni yazar', async () => {
    await tmp.pool.query(`create role ${role} login password '${password}'`);
    await tmp.pool.query(`grant connect on database "${tmp.name}" to ${role}`);
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DATABASE_URL: withUser(tmp.url, role, password),
      WORKER_PROCESS: 'worker',
      WORKER_SCHEDULES: 'off',
      HEALTH_HOST: '127.0.0.1',
      HEALTH_PORT: '0',
      WORKER_STARTUP_EXIT_DELAY_MS: '0',
      OGRENMEN_LLM: 'fake',
      LOG_LEVEL: 'error',
    };
    const { code, out } = await new Promise<{ code: number | null; out: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: WORKER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr.on('data', (d: Buffer) => (out += d.toString()));
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`süreç 45 sn içinde çıkmadı: ${out}`));
      }, 45_000);
      child.on('exit', (c) => {
        clearTimeout(timer);
        resolve({ code: c, out });
      });
    });
    expect(code, out).toBe(78);
    expect(out).toContain('pgboss.preflight');
    expect(out).toContain(role);
    expect(out).toContain('USAGE');
  }, 60_000);
  it("WORKER_STARTUP_CHECKS=warn da ön denetim düşünce start 78'lik hatayla düşer (pg-boss başlatılmaz)", async () => {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: withUser(tmp.url, role, password), max: 2 });
    try {
      app = createApp(cfg({ DATABASE_URL: withUser(tmp.url, role, password), WORKER_STARTUP_CHECKS: 'warn', OUTBOX_DRAIN_INTERVAL_MS: '0' }), { log: silentLogger, db: pool, pdf: fakePdf });
      const err = await app.start().then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(StartupCheckError);
      expect((err as StartupCheckError).exitCode).toBe(78);
      expect((err as StartupCheckError).message).toContain('pgboss.preflight');
      expect((err as StartupCheckError).message).toContain('USAGE');
      const h = await fetch(`http://127.0.0.1:${app.healthPort}/healthz`);
      expect(h.status).toBe(503);
      expect(((await h.json()) as { startupChecks: Record<string, string> }).startupChecks['pgboss.preflight']).toMatch(/^fail/);
      await app.stop();
      app = undefined;
    } finally {
      await pool.end();
    }
  }, 60_000);

  it('outbox: yetkili ama BYPASSRLS olmayan rol düşer (FORCE RLS 0 satır gösterir); BYPASSRLS ile geçer', async () => {
    await tmp.pool.query(`create role ${outboxRole} login password '${password}' nobypassrls`);
    await tmp.pool.query(`grant connect on database "${tmp.name}" to ${outboxRole}`);
    await tmp.pool.query(`grant usage on schema secure to ${outboxRole}`);
    await tmp.pool.query(`grant select, update, delete on secure.job_outbox to ${outboxRole}`);
    await tmp.pool.query(`insert into secure.job_outbox (name, data, reason) values ('noop', '{}', 'rls-test')`);
    const pg = (await import('pg')).default;
    const connect = async () => {
      const c = new pg.Client({ connectionString: withUser(tmp.url, outboxRole, password) });
      await c.connect();
      return c;
    };
    let c = await connect();
    try {
      // rol satırı göremez: eski denetim burada "ok (0 bekleyen iş)" derdi
      expect((await c.query(`select count(*)::int as n from secure.job_outbox`)).rows[0]!.n).toBe(0);
      const r = await checkOutbox(c);
      expect(r).toMatchObject({ status: 'fail', available: false });
      expect(r.detail).toContain(outboxRole);
      expect(r.detail).toContain('(BYPASSRLS)');
    } finally {
      await c.end();
    }
    // yetkisiz rol (USAGE yok) da düşer, hata vermeden
    await tmp.pool.query(`revoke usage on schema secure from ${outboxRole}`);
    c = await connect();
    try {
      const r = await checkOutbox(c);
      expect(r).toMatchObject({ status: 'fail' });
      expect(r.detail).toContain('(SCHEMA USAGE, BYPASSRLS)');
    } finally {
      await c.end();
    }
    await tmp.pool.query(`grant usage on schema secure to ${outboxRole}`);
    await tmp.pool.query(`alter role ${outboxRole} bypassrls`);
    c = await connect();
    try {
      expect(await checkOutbox(c)).toMatchObject({ status: 'ok', available: true, detail: expect.stringContaining('1 bekleyen') });
    } finally {
      await c.end();
      await tmp.pool.query(`delete from secure.job_outbox where reason = 'rls-test'`);
    }
  }, 60_000);
});
