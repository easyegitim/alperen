/**
 * Başlangıç denetimleri (sahte veritabanı) ve outbox aktarımı (sahte işlem havuzu). Gerçek Postgres + pg-boss ile aynı
 * akış: test/startup.live.test.ts (yetkisiz rol → çıkış 78, outbox.drain).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { getJob, jobNames } from '../src/jobs/registry.js';
import { drainOutbox, STUCK_ATTEMPTS, type TxClient, type TxPool } from '../src/outbox.js';
import { silentLogger, type Logger } from '../src/log.js';
import {
  checkConnectionRole,
  checkEnqueueJob,
  checkOutbox,
  checkQueues,
  parseProbe,
  preflightPgboss,
  PROBE_QUEUE,
  REQUIRED_QUEUES,
  runStartupChecks,
  StartupCheckError,
  STARTUP_EXIT_CODE,
} from '../src/startup-checks.js';
import { jobCtx, routedDb, type Route } from './support.js';

const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');

const allTrue = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, true]));
const ROLE_PRIVS = ['job_select', 'job_insert', 'job_update', 'job_delete', 'queue_select', 'queue_insert', 'queue_update'];
const DEFINER_PRIVS = ['schema_usage', 'queue_select', 'job_select', 'job_insert'];
const probeOk = () => {
  throw Object.assign(new Error('OGR-PROBE ok '), { code: 'P0001' });
};

function healthyRoutes(over: Route[] = []): Route[] {
  return [
    ...over,
    [/as has_job/, () => [{ role: 'worker', has_job: true, has_queue: true }]],
    [/as job_select, has_table_privilege\(current_user/, () => [allTrue(ROLE_PRIVS)]],
    [/from pg_proc p join pg_namespace/, () => [{ secdef: true, owner: 'postgres', executable: true }]],
    [/has_schema_privilege\(\$1, 'pgboss'/, () => [allTrue(DEFINER_PRIVS)]],
    [/^do \$probe\$/, probeOk],
    [/as outbox_oid/, () => [{ outbox_oid: '16400', role: 'worker', bypass: true }]],
    [/'secure', 'USAGE'/, () => [{ schema_usage: true, select: true, update: true, delete: true }]],
    [/count\(\*\)::int as n from secure.job_outbox/, () => [{ n: 2 }]],
  ];
}

function queueOps(existing: string[] = []) {
  const set = new Set(existing);
  const created: string[] = [];
  return {
    created,
    ops: {
      exists: async (n: string) => set.has(n),
      create: async (n: string) => {
        set.add(n);
        created.push(n);
      },
    },
  };
}

describe('başlangıç denetimleri', () => {
  it('gerekli kuyruklar kayıt defterinde; SQL göçlerinin kuyruğa attığı her ad gerekli listede', () => {
    for (const n of REQUIRED_QUEUES) expect(getJob(n), n).toBeDefined();
    const sqlNames = new Set<string>();
    for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql'))) {
      for (const m of readFileSync(join(MIGRATIONS, f), 'utf8').matchAll(/(?:try_enqueue|enqueue_job)\('([a-z][a-z0-9_.]+)'/g)) sqlNames.add(m[1]!);
    }
    expect(sqlNames.size).toBeGreaterThan(5);
    for (const n of sqlNames) expect(REQUIRED_QUEUES, `SQL '${n}' kuyruğu gerekli listede değil`).toContain(n);
    expect(jobNames()).toContain('outbox.drain');
    expect(STARTUP_EXIT_CODE).toBe(78);
  });

  it('ön denetim: şema varsa USAGE, yoksa CREATE ister', async () => {
    const noUsage = routedDb([[/has_database_privilege/, () => [{ role: 'w', exists: true, usage: false, can_create: true }]]]);
    expect(await preflightPgboss(noUsage, 'pgboss')).toMatchObject({ status: 'fail', detail: expect.stringContaining('USAGE') });
    const noCreate = routedDb([[/has_database_privilege/, () => [{ role: 'w', exists: false, usage: null, can_create: false }]]]);
    expect(await preflightPgboss(noCreate, 'pgboss')).toMatchObject({ status: 'fail', detail: expect.stringContaining('CREATE') });
    const ok = routedDb([[/has_database_privilege/, () => [{ role: 'w', exists: true, usage: true, can_create: false }]]]);
    expect((await preflightPgboss(ok, 'pgboss')).status).toBe('ok');
  });

  it('(a) bağlantı rolü: eksik yetkiyi adlarıyla bildirir', async () => {
    const db = routedDb([
      [/as has_job/, () => [{ role: 'ogr_ro', has_job: true, has_queue: true }]],
      [/as job_select/, () => [{ ...allTrue(ROLE_PRIVS), job_insert: false, queue_update: false }]],
    ]);
    const r = await checkConnectionRole(db, 'pgboss');
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('ogr_ro');
    expect(r.detail).toContain('JOB INSERT');
    expect(r.detail).toContain('QUEUE UPDATE');
  });

  it('(c) eksik kuyrukları açar ve bildirir; açılamayan kuyruk düşer', async () => {
    const { ops, created } = queueOps(['a.b']);
    expect(await checkQueues(['a.b', 'c.d', PROBE_QUEUE], ops)).toMatchObject({ status: 'fixed', detail: expect.stringContaining('c.d') });
    expect(created).toEqual(['c.d', PROBE_QUEUE]);
    const broken = { exists: async () => false, create: async () => Promise.reject(new Error('izin yok')) };
    expect(await checkQueues(['x.y'], broken)).toMatchObject({ status: 'fail', detail: expect.stringContaining('izin yok') });
  });

  it('(b) enqueue_job: sahip yetkiliyse deneme geri alınan blokta yazar', async () => {
    const db = routedDb(healthyRoutes());
    expect(await checkEnqueueJob(db, 'pgboss', 'off')).toMatchObject({ status: 'ok', detail: expect.stringContaining(PROBE_QUEUE) });
    expect(db.calls.some((c) => c.text.startsWith('do $probe$') && c.text.includes(`enqueue_job('${PROBE_QUEUE}'`))).toBe(true);
  });

  it('(b) enqueue_job: SECURITY DEFINER sahibi yetkisizse grant=off düşer, grant=auto verir', async () => {
    let granted = false;
    const routes = (): Route[] =>
      healthyRoutes([
        [/has_schema_privilege\(\$1, 'pgboss'/, () => [granted ? allTrue(DEFINER_PRIVS) : { ...allTrue(DEFINER_PRIVS), schema_usage: false, job_insert: false }]],
        [/^grant usage on schema pgboss to "ogrenmen_owner"/, () => ((granted = true), [])],
        [/from pg_proc p join pg_namespace/, () => [{ secdef: true, owner: 'ogrenmen_owner', executable: true }]],
      ]);
    const off = await checkEnqueueJob(routedDb(routes()), 'pgboss', 'off');
    expect(off.status).toBe('fail');
    expect(off.detail).toContain('ogrenmen_owner');
    expect(off.detail).toContain('grant select, insert on pgboss.job to "ogrenmen_owner"');
    expect(granted).toBe(false);
    const auto = await checkEnqueueJob(routedDb(routes()), 'pgboss', 'auto');
    expect(granted).toBe(true);
    expect(auto).toMatchObject({ status: 'fixed', detail: expect.stringContaining('verildi') });
  });

  it("(b) enqueue_job: yetki veremeyen bağlantı ve outbox'a düşen deneme açık hatayla düşer", async () => {
    const cannot = routedDb(
      healthyRoutes([
        [/has_schema_privilege\(\$1, 'pgboss'/, () => [{ ...allTrue(DEFINER_PRIVS), job_insert: false }]],
        [/^grant usage/, () => Promise.reject(new Error('permission denied for schema pgboss')) as never],
      ]),
    );
    const r1 = await checkEnqueueJob(cannot, 'pgboss', 'auto');
    expect(r1.status).toBe('fail');
    expect(r1.detail).toContain('yetki veremedi');
    const outboxed = routedDb(
      healthyRoutes([
        [
          /^do \$probe\$/,
          () => {
            throw new Error('OGR-PROBE fail OGR-JOB-001 kuyruk yok: startup.probe (worker createQueue çağırmalı)');
          },
        ],
      ]),
    );
    const r2 = await checkEnqueueJob(outboxed, 'pgboss', 'auto');
    expect(r2.status).toBe('fail');
    expect(r2.detail).toContain('kuyruk yok');
    expect(parseProbe(new Error('OGR-PROBE ok '))).toEqual({ ok: true, reason: '' });
    expect(parseProbe(new Error('permission denied for function enqueue_job'))).toMatchObject({ ok: false });
  });

  it('(b) enqueue_job yoksa düşer; pgboss dışı şemada (testler) atlanır', async () => {
    const none = routedDb([[/from pg_proc p join pg_namespace/, () => []]]);
    expect(await checkEnqueueJob(none, 'pgboss', 'auto')).toMatchObject({ status: 'fail', detail: expect.stringContaining('göçleri') });
    expect((await checkEnqueueJob(none, 'pgboss_t_ab', 'auto')).status).toBe('skip');
  });

  it('outbox: tablo yoksa uyarı (aktarım kapalı), varsa bekleyen sayı; tablo oid ile sorulur', async () => {
    expect(await checkOutbox(routedDb([[/as outbox_oid/, () => [{ outbox_oid: null, role: 'w', bypass: true }]]]))).toMatchObject({ status: 'warn', available: false });
    const db = routedDb(healthyRoutes());
    expect(await checkOutbox(db)).toMatchObject({ status: 'ok', available: true, detail: expect.stringContaining('2 bekleyen') });
    expect(db.calls.find((c) => c.text.includes("'secure', 'USAGE'"))?.values).toEqual(['16400']);
  });

  it('outbox: tablo varken RLS atlamayan rol ya da eksik yetki düşer (işler sessizce birikmez)', async () => {
    // FORCE RLS + politika yok: yetkili ama BYPASSRLS olmayan rol 0 satır görürdü ve "ok (0 bekleyen)" derdi
    const noBypass = await checkOutbox(routedDb(healthyRoutes([[/as outbox_oid/, () => [{ outbox_oid: '16400', role: 'ogr_worker', bypass: false }]]])));
    expect(noBypass).toMatchObject({ status: 'fail', available: false });
    expect(noBypass.detail).toContain('ogr_worker');
    expect(noBypass.detail).toContain('(BYPASSRLS)');
    const noDelete = await checkOutbox(routedDb(healthyRoutes([[/'secure', 'USAGE'/, () => [{ schema_usage: false, select: true, update: true, delete: false }]]])));
    expect(noDelete).toMatchObject({ status: 'fail', available: false });
    expect(noDelete.detail).toContain('(SCHEMA USAGE, DELETE)');
    const broken = await checkOutbox(routedDb([[/as outbox_oid/, () => Promise.reject(new Error('bağlantı koptu')) as never]]));
    expect(broken).toMatchObject({ status: 'fail', detail: expect.stringContaining('bağlantı koptu') });
    // rapor geçersiz: strict kip 78 ile çıkar
    const r = await runStartupChecks({
      db: routedDb(healthyRoutes([[/as outbox_oid/, () => [{ outbox_oid: '16400', role: 'ogr_worker', bypass: false }]]])),
      schema: 'pgboss',
      queues: REQUIRED_QUEUES,
      ops: queueOps([...REQUIRED_QUEUES, PROBE_QUEUE]).ops,
      grant: 'auto',
    });
    expect(r).toMatchObject({ ok: false, outbox: false });
    expect(new StartupCheckError(r).message).toContain('outbox: rol ogr_worker');
  });

  it('rapor: herhangi bir fail geçersiz kılar; StartupCheckError 78 taşır', async () => {
    const ok = await runStartupChecks({ db: routedDb(healthyRoutes()), schema: 'pgboss', queues: REQUIRED_QUEUES, ops: queueOps([...REQUIRED_QUEUES, PROBE_QUEUE]).ops, grant: 'auto' });
    expect(ok.ok).toBe(true);
    expect(ok.outbox).toBe(true);
    expect(ok.checks.map((c) => c.name)).toEqual(['pgboss.role', 'pgboss.queues', 'enqueue_job', 'outbox']);
    const bad = await runStartupChecks({
      db: routedDb([[/as has_job/, () => [{ role: 'w', has_job: false, has_queue: false }]]]),
      schema: 'pgboss',
      queues: REQUIRED_QUEUES,
      ops: queueOps().ops,
      grant: 'auto',
    });
    expect(bad.ok).toBe(false);
    const err = new StartupCheckError(bad);
    expect(err.exitCode).toBe(78);
    expect(err.message).toContain('pgboss.role');
  });

  it('yapılandırma: strict varsayılan, 30 sn outbox aralığı, geçersiz değer reddedilir', () => {
    const c = loadConfig({ DATABASE_URL: 'postgresql://u@h/d' }, []);
    expect(c.startupChecks).toBe('strict');
    expect(c.pgbossGrant).toBe('auto');
    expect(c.outboxDrainIntervalMs).toBe(30_000);
    expect(() => loadConfig({ DATABASE_URL: 'x://y', WORKER_STARTUP_CHECKS: 'belki' }, [])).toThrow(/WORKER_STARTUP_CHECKS/);
  });
});

/** Sahte işlem havuzu: outbox satırları bellekte; begin/commit/savepoint davranışı basitçe izlenir. */
function fakeOutbox(rows: { id: string; name: string; data: unknown; attempts?: number }[]) {
  const table = rows.map((r) => ({ attempts: 0, retried_at: null as Date | null, last_error: null as string | null, ...r }));
  const log: string[] = [];
  let pending: { del: Set<string> } = { del: new Set() };
  const client: TxClient = {
    async query(text, values) {
      log.push(text.split('\n')[0]!.trim());
      if (text === 'begin') pending = { del: new Set() };
      if (text.includes('from secure.job_outbox o')) {
        const lim = Number(values?.[1] ?? 100);
        return { rows: table.filter((r) => r.retried_at === null && !pending.del.has(r.id)).slice(0, lim).map((r) => ({ id: r.id, name: r.name, data: r.data })) };
      }
      if (text.startsWith('delete from secure.job_outbox')) pending.del.add(String(values?.[0]));
      if (text.startsWith('update secure.job_outbox')) {
        const r = table.find((x) => x.id === values?.[0])!;
        r.attempts++;
        r.retried_at = new Date();
        r.last_error = String(values?.[1]);
      }
      if (text === 'commit') {
        for (const id of pending.del) table.splice(table.findIndex((r) => r.id === id), 1);
      }
      if (text.startsWith('select count(*)')) {
        const min = Number(values?.[0] ?? 3);
        return { rows: [{ n: table.length, oldest_age_sec: table.length > 0 ? 7200 : 0, stuck: table.filter((r) => r.attempts >= min).length }] };
      }
      return { rows: [] };
    },
    release: () => undefined,
  };
  const pool: TxPool = { connect: async () => client };
  return { table, log, pool };
}

describe('outbox aktarımı', () => {
  it('satırları outbox kimliğiyle aynı işlemde gönderir ve siler; kuyruğu olmayan satır kalır', async () => {
    const ob = fakeOutbox([
      { id: '00000000-0000-4000-8000-000000000001', name: 'curriculum.draft', data: { curriculum_id: 'c1' } },
      { id: '00000000-0000-4000-8000-000000000002', name: 'yok.kuyruk', data: {} },
      { id: '00000000-0000-4000-8000-000000000003', name: 'suggestions.refresh', data: { student_id: 's1' } },
    ]);
    const sent: { name: string; data: object; id: string; tx: boolean }[] = [];
    const r = await drainOutbox({
      pool: ob.pool,
      send: async (name, data, id, tx) => {
        sent.push({ name, data, id, tx: typeof tx.executeSql === 'function' });
        return id;
      },
      queueExists: async (n) => n !== 'yok.kuyruk',
    });
    expect(r).toMatchObject({ moved: 2, failed: 1, pending: 1, stuck: 0, byName: { 'curriculum.draft': 1, 'suggestions.refresh': 1 } });
    expect(sent.map((s) => [s.name, s.id, s.tx])).toEqual([
      ['curriculum.draft', '00000000-0000-4000-8000-000000000001', true],
      ['suggestions.refresh', '00000000-0000-4000-8000-000000000003', true],
    ]);
    expect(sent[0]!.data).toEqual({ curriculum_id: 'c1' });
    expect(ob.table).toHaveLength(1);
    expect(ob.table[0]).toMatchObject({ name: 'yok.kuyruk', attempts: 1, last_error: 'kuyruk yok: yok.kuyruk' });
    expect(ob.log).toContain('rollback to savepoint outbox_row');
    expect(ob.log[0]).toBe('begin');
    expect(ob.log).toContain('commit');
  });

  it('gönderim hatası satırı geri alır ve denemeyi sayar; diğer satırlar aktarılır', async () => {
    const ob = fakeOutbox([
      { id: 'a', name: 'noop', data: {} },
      { id: 'b', name: 'noop', data: {} },
    ]);
    const r = await drainOutbox({
      pool: ob.pool,
      send: async (_n, _d, id) => {
        if (id === 'a') throw new Error('bağlantı koptu');
        return id;
      },
      queueExists: async () => true,
    });
    expect(r).toMatchObject({ moved: 1, failed: 1, pending: 1 });
    expect(ob.table[0]).toMatchObject({ id: 'a', attempts: 1, last_error: 'bağlantı koptu' });
  });

  it('takılı (attempts >= 3) ya da bir saatten eski satır sayılır ve hata günlüğü yazar', async () => {
    const ob = fakeOutbox([
      { id: 'x', name: 'yok.kuyruk', data: {}, attempts: STUCK_ATTEMPTS - 1 },
      { id: 'y', name: 'noop', data: {} },
    ]);
    const errors: { msg: string; fields: Record<string, unknown> | undefined }[] = [];
    const log = { ...silentLogger, error: (msg: string, fields?: Record<string, unknown>) => void errors.push({ msg, fields }) } as Logger;
    const r = await drainOutbox({ pool: ob.pool, send: async (_n, _d, id) => id, queueExists: async (n) => n !== 'yok.kuyruk', log });
    expect(r).toMatchObject({ moved: 1, failed: 1, pending: 1, stuck: 1, oldestAgeSec: 7200 });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ msg: expect.stringContaining('birikiyor'), fields: { stuck: 1, oldestAgeSec: 7200 } });
    // boş outbox: hata yok
    const empty = fakeOutbox([]);
    const quiet: unknown[] = [];
    const r2 = await drainOutbox({ pool: empty.pool, send: async (_n, _d, id) => id, queueExists: async () => true, log: { ...silentLogger, error: (m: string) => void quiet.push(m) } as Logger });
    expect(r2).toMatchObject({ pending: 0, stuck: 0, oldestAgeSec: 0 });
    expect(quiet).toEqual([]);
  });

  it('outbox.drain işi bağımlılık yoksa kalıcı hata, varsa sonucu döner', async () => {
    const def = getJob('outbox.drain')!;
    await expect(def.handler!({}, jobCtx())).rejects.toThrow(/kapalı/);
    const out = await def.handler!({}, jobCtx({ drainOutbox: async () => ({ moved: 3, failed: 0, pending: 0, oldestAgeSec: 0, stuck: 0, byName: { noop: 3 } }) }));
    expect(out).toMatchObject({ moved: 3 });
  });
});
