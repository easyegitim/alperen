// supabase/scripts/pgboss-check.mjs — public.enqueue_job()'u GERÇEK pg-boss şemasına karşı sınar (db-test.sh çağırır).
// pg-boss apps/worker bağımlılığıdır; çözülemezse "SKIP: no pg-boss" yazar ve 0 ile çıkar. Kullanım:
//   node pgboss-check.mjs <test-veritabanı-url> <migration-sahibi-rol>
// Adımlar: pg-boss kurulur (start), bir kuyruk createQueue seçenekleriyle açılır, migration sahibine (enqueue_job'un
// SECURITY DEFINER sahibi) pgboss şemasında USAGE + SELECT/INSERT verilir, SQL'den iş eklenir; işin ayarları kuyruğunkiyle
// aynı olmalı, kuyruk yoksa OGR-JOB-001 'kuyruk yok' yükselmeli ve pg-boss işi fetch ile almalı.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', '..', 'apps', 'worker', 'package.json'));
let PgBoss;
let pg;
try {
  ({ PgBoss } = require('pg-boss'));
  pg = require('pg');
} catch {
  console.log('SKIP: no pg-boss (apps/worker bağımlılıkları kurulu değil)');
  process.exit(0);
}

const [url, owner] = process.argv.slice(2);
if (!url || !owner) {
  console.error('kullanım: node pgboss-check.mjs <url> <rol>');
  process.exit(2);
}
let failed = false;
const ok = (cond, label) => {
  console.log(`${cond ? 'OK' : 'FAIL'}: ${label}`);
  if (!cond) failed = true;
};

const boss = new PgBoss({ connectionString: url, schema: 'pgboss' });
boss.on('error', (e) => console.error('pg-boss hatası:', e.message));
const c = new pg.Client({ connectionString: url });
try {
  await boss.start();
  const opts = { retryLimit: 7, retryDelay: 11, retryBackoff: true, expireInSeconds: 5400, retentionSeconds: 7200,
                 deleteAfterSeconds: 3000, heartbeatSeconds: 45 };
  await boss.createQueue('exam.report', opts);
  await c.connect();
  await c.query(`grant usage on schema pgboss to ${owner}; grant select on pgboss.queue to ${owner};
                 grant select, insert on pgboss.job to ${owner}`);
  const id = (await c.query(`select public.enqueue_job('exam.report', '{"session_id":"s1"}') as id`)).rows[0].id;
  ok(id != null, 'gerçek pg-boss şemasında enqueue_job iş kimliği döner');
  const j = (await c.query(`select retry_limit, retry_delay, retry_backoff, expire_seconds, deletion_seconds, heartbeat_seconds, policy,
                                   extract(epoch from keep_until - start_after)::int as keep, state::text
                              from pgboss.job where id = $1`, [id])).rows[0];
  ok(j && j.retry_limit === 7 && j.retry_delay === 11 && j.retry_backoff === true && j.expire_seconds === 5400
       && j.deletion_seconds === 3000 && j.heartbeat_seconds === 45 && j.keep === 7200 && j.state === 'created',
     `iş ayarları createQueue seçenekleriyle aynı (${JSON.stringify(j)})`);
  let msg = '';
  try {
    await c.query(`select public.enqueue_job('yok.kuyruk', '{}')`);
  } catch (e) {
    msg = e.message;
  }
  ok(msg.startsWith('OGR-JOB-001 kuyruk yok'), `kuyruk yoksa OGR-JOB-001 (${msg})`);
  const jobs = await boss.fetch('exam.report');
  ok(jobs.length === 1 && jobs[0].id === id && jobs[0].data?.session_id === 's1', 'pg-boss SQL\'den eklenen işi fetch ile alır');
} catch (e) {
  ok(false, `pg-boss sınaması düştü: ${e.message}`);
} finally {
  await c.end().catch(() => {});
  await boss.stop({ graceful: false, wait: true }).catch(() => {});
}
process.exit(failed ? 1 : 0);
