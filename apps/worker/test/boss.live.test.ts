/**
 * pg-boss entegrasyon testi: yerel Postgres'te geçici şema (pgboss_t_<rastgele>) kurar, iş koşturur, şemayı siler.
 * OGRENMEN_LIVE=1 ve DATABASE_URL (ya da OGRENMEN_DATABASE_URL) yoksa atlanır.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/log.js';
import { installSchedules, removeSchedules, SCHEDULES } from '../src/schedules.js';

const url = process.env.DATABASE_URL ?? process.env.OGRENMEN_DATABASE_URL ?? 'postgresql://ogrenmen:ogrenmen@127.0.0.1:5432/ogrenmen';
const live = process.env.OGRENMEN_LIVE === '1';
const schema = `pgboss_t_${randomBytes(4).toString('hex')}`;

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('beklenen durum oluşmadı');
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe.skipIf(!live)('pg-boss entegrasyonu (geçici şema)', () => {
  let app: App;
  const admin = new pg.Pool({ connectionString: url, max: 1 });

  beforeAll(async () => {
    const config = loadConfig({ DATABASE_URL: url, PGBOSS_SCHEMA: schema, HEALTH_HOST: '127.0.0.1', HEALTH_PORT: '0', WORKER_SCHEDULES: 'off', PDF_CONCURRENCY: '1' }, ['--process=all']);
    app = createApp(config, { log: silentLogger, pdf: { render: async () => ({ pdf: Buffer.from('%PDF-1.4'), pages: 1, bytes: 8 }), close: async () => undefined } });
    await app.start();
  });

  afterAll(async () => {
    await app?.stop();
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  });

  it('noop işi uçtan uca tamamlanır', async () => {
    const id = await app.enqueue('noop', { echo: { a: 1 } });
    expect(id).toBeTruthy();
    const job = await waitFor(async () => {
      const [j] = await app.boss.findJobs<object>('noop', { id: id! });
      return j?.state === 'completed' ? j : null;
    });
    expect(job.output).toMatchObject({ ok: true, echo: { a: 1 } });
  });

  it('hatalı iş yeniden denenmeden başarısız olur (retryLimit 0)', async () => {
    const id = await app.enqueue('noop', { fail: true });
    const job = await waitFor(async () => {
      const [j] = await app.boss.findJobs<object>('noop', { id: id! });
      return j?.state === 'failed' ? j : null;
    });
    expect(job.state).toBe('failed');
  });

  it('geçersiz yük dead_letter kuyruğuna gider', async () => {
    const id = await app.enqueue('dossier.render', { student_id: 'uuid-degil' });
    await waitFor(async () => {
      const [j] = await app.boss.findJobs<object>('dossier.render', { id: id! });
      return j && j.state === 'failed' ? j : null;
    });
    const dl = await waitFor(async () => {
      const jobs = await app.boss.findJobs<object>('dead_letter', { data: { student_id: 'uuid-degil' } });
      return jobs.length > 0 ? jobs : null;
    });
    expect(dl).toHaveLength(1);
  });

  it('pdf.render işi (sahte çizici + sahte Storage olmadan) kalıcı hataya düşer: Storage yapılandırılmamış', async () => {
    const id = await app.enqueue('pdf.render', { html: '<p>x</p>', output: { path: 'a/b.pdf' } });
    const job = await waitFor(async () => {
      const [j] = await app.boss.findJobs<object>('pdf.render', { id: id! });
      return j?.state === 'failed' ? j : null;
    });
    expect(JSON.stringify(job.output)).toContain('OGR-JOB-104');
  });

  it('sağlık ucu 200 döner, bilinmeyen yol 404', async () => {
    const ok = await fetch(`http://127.0.0.1:${app.healthPort}/healthz`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { status: string }).status).toBe('ok');
    expect((await fetch(`http://127.0.0.1:${app.healthPort}/baska`)).status).toBe(404);
  });

  it('zamanlamalar Europe/Istanbul ile kurulur ve idempotenttir', async () => {
    await installSchedules(app.boss);
    await installSchedules(app.boss);
    const s = await app.boss.getSchedules();
    expect(s.map((x) => x.name).sort()).toEqual(SCHEDULES.map((x) => x.job).sort());
    for (const x of s) expect(x.timezone).toBe('Europe/Istanbul');
  });

  it('SQL ile (kuyruk satırından kopyalanan ayarlarla) eklenen bozuk yüklü iş dead_letter kuyruğuna düşer', async () => {
    const r = await admin.query<{ id: string; dead_letter: string | null; retry_limit: number }>(
      `insert into ${schema}.job (name, data, policy, retry_limit, retry_delay, retry_backoff, retry_delay_max, expire_seconds, deletion_seconds, keep_until, dead_letter)
       select q.name, $2::jsonb, q.policy, q.retry_limit, q.retry_delay, q.retry_backoff, q.retry_delay_max, q.expire_seconds, q.deletion_seconds,
              now() + make_interval(secs => q.retention_seconds), q.dead_letter
         from ${schema}.queue q where q.name = $1 returning id, dead_letter, retry_limit`,
      ['dossier.render', JSON.stringify({ student_id: 'sql-bozuk-yuk' })],
    );
    expect(r.rows[0]?.dead_letter).toBe('dead_letter');
    const id = r.rows[0]!.id;
    await waitFor(async () => {
      const [j] = await app.boss.findJobs<object>('dossier.render', { id });
      return j?.state === 'failed' ? j : null;
    });
    const dl = await waitFor(async () => {
      const jobs = await app.boss.findJobs<object>('dead_letter', { data: { student_id: 'sql-bozuk-yuk' } });
      return jobs.length > 0 ? jobs : null;
    });
    expect(dl).toHaveLength(1);
  });

  it('zamanlama kurulmadığında eski kayıtlar silinir (install sonra off)', async () => {
    await installSchedules(app.boss);
    expect((await app.boss.getSchedules()).length).toBe(SCHEDULES.length);
    await removeSchedules(app.boss);
    expect(await app.boss.getSchedules()).toEqual([]);
  });
});
