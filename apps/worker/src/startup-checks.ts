/**
 * Başlangıç denetimleri: worker açılırken SQL'den kuyruğa atılan işlerin (onboarding_enroll, submit_upload,
 * start_practice, apply_diagnosis …) gerçekten pg-boss'a ulaşabildiğini kanıtlar. Önceden worker pgboss şemasını
 * enqueue_job'un SECURITY DEFINER sahibinin erişemeyeceği bir rolle kurarsa işler sessizce düşüyordu
 * (audit.events 'job.enqueue_failed'). Denetimler:
 *
 *   ön denetim  bağlantı rolü pgboss şemasını kurabilir/kullanabilir mi (pg-boss başlamadan; şema varsa USAGE,
 *               yoksa veritabanında CREATE)
 *   (a) rol     bağlantı rolünün pgboss.job (SELECT/INSERT/UPDATE/DELETE) ve pgboss.queue (SELECT/INSERT/UPDATE) yetkisi
 *   (c) kuyruk  gerekli kuyruklar (`REQUIRED_QUEUES` + kayıt defteri + `startup.probe`) var; eksikse açılır
 *   (b) enqueue public.enqueue_job var; SECURITY DEFINER ise sahibinin pgboss'ta USAGE + queue SELECT + job SELECT/INSERT
 *               yetkisi (eksikse `WORKER_PGBOSS_GRANT=auto` iken bağlantı rolü verebiliyorsa verilir); ardından deneme:
 *               `enqueue_job('startup.probe')` geri alınan bir DO bloğunda pgboss.job'a satır yazar (ekle → geri al)
 *   outbox      secure.job_outbox (0029) okunup silinebiliyor mu ve rol RLS'yi atlıyor mu (outbox.drain); tablo yoksa
 *               uyarı, varsa ama aktarılamıyorsa fail
 *
 * Bir denetim `fail` olursa rapor geçersizdir: `WORKER_STARTUP_CHECKS=strict` (varsayılan) süreç 78 (EX_CONFIG) ile
 * çıkar, `warn` sağlık 'degraded' ile sürer. Sırlar günlüğe yazılmaz (yalnız rol/şema adları).
 */
import type { Db } from './db.js';
import type { Logger } from './log.js';

/** sysexits.h EX_CONFIG: yapılandırma/yetki hatası; Fly yeniden başlatsa da aynı sonuç (günlükte açık neden). */
export const STARTUP_EXIT_CODE = 78;

/** Deneme kuyruğu: enqueue_job buraya yazar, DO bloğu geri alınır (satır kalmaz). */
export const PROBE_QUEUE = 'startup.probe';

/**
 * SQL'in ya da web'in kuyruğa attığı, açık olması zorunlu kuyruklar. Kayıt defterindeki her ad zaten açılır; bu liste
 * kayıt defterinden bir ad düşerse bile denetimin onları istemesini sağlar (registry.test.ts ikisini karşılaştırır).
 * `memory.apply` koç hafızası için kullanılmaz (0028 kuyruksuz yazar); üreticisi P5 ders hattıdır (0041 apply_lesson_claims).
 */
export const REQUIRED_QUEUES: readonly string[] = [
  'curriculum.draft',
  'curriculum.merge',
  'curriculum.proposals.review',
  'suggestions.refresh',
  'practice.generate',
  'practice.prewarm',
  'memory.correction',
  'memory.compact',
  'upload.intake',
  'diagnosis.run',
  'diagnosis.followup',
  'conversation.summarize',
  'exam.analyse',
  'exam.report',
  'document.generate',
  'weekly.summary',
  'pdf.render',
  'push.send',
  'outbox.drain',
  'style.ingest', 'style.coverage.refresh', 'style.question_gen', // P4 (ingest_exam_source → style.ingest)
  'lesson.prepare', 'lesson.stt', 'lesson.label', 'lesson.analyse', 'lesson.retention', 'memory.apply', // P5 (register_lesson, apply_lesson_claims)
  'notifications.evaluate', 'email.send', 'report.generate', // P6 (parent_request_report → report.generate; emit_notification → push.send)
];

export type CheckStatus = 'ok' | 'fixed' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface StartupReport {
  ok: boolean;
  checks: CheckResult[];
  /** secure.job_outbox aktarımı yapılabilir mi (outbox.drain). */
  outbox: boolean;
}

export class StartupCheckError extends Error {
  readonly exitCode = STARTUP_EXIT_CODE;
  constructor(readonly report: StartupReport) {
    super(`başlangıç denetimi düştü: ${failures(report).map((c) => `${c.name}: ${c.detail}`).join(' | ')}`);
    this.name = 'StartupCheckError';
  }
}

export function failures(report: StartupReport): CheckResult[] {
  return report.checks.filter((c) => c.status === 'fail');
}

/** Pg-boss işlemlerinden denetimin gördüğü kadarı (testlerde sahtesi). */
export interface QueueOps {
  exists(name: string): Promise<boolean>;
  /** Kuyruğu açar (kayıt defterindeyse kendi politikasıyla). */
  create(name: string): Promise<void>;
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function one<T extends Record<string, unknown>>(db: Db, sql: string, values: unknown[] = []): Promise<T> {
  const r = await db.query(sql, values);
  return (r.rows[0] ?? {}) as T;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Ön denetim (pg-boss başlamadan): şema varsa bağlantı rolünün USAGE yetkisi; yoksa veritabanında CREATE yetkisi
 * (pg-boss şemayı kendisi kurar). Yetkisiz rol pg-boss'u başlatırken anlaşılmaz bir hatayla düşerdi.
 */
export async function preflightPgboss(db: Db, schema: string): Promise<CheckResult> {
  const name = 'pgboss.preflight';
  try {
    const r = await one<{ role: string; exists: boolean; usage: boolean | null; can_create: boolean }>(
      db,
      `select current_user::text as role,
              exists (select 1 from pg_namespace where nspname = $1) as exists,
              case when exists (select 1 from pg_namespace where nspname = $1) then has_schema_privilege(current_user, $1, 'USAGE') end as usage,
              has_database_privilege(current_user, current_database(), 'CREATE') as can_create`,
      [schema],
    );
    if (r.exists && !r.usage) {
      return { name, status: 'fail', detail: `bağlantı rolü ${r.role} '${schema}' şemasında USAGE yetkisine sahip değil (worker'ı pgboss'u kuran rolle ya da 'postgres' ile bağla)` };
    }
    if (!r.exists && !r.can_create) {
      return { name, status: 'fail', detail: `'${schema}' şeması yok ve bağlantı rolü ${r.role} veritabanında şema kuramaz (CREATE yetkisi yok)` };
    }
    return { name, status: 'ok', detail: r.exists ? `rol ${r.role}, şema '${schema}' var` : `rol ${r.role}, şema '${schema}' pg-boss tarafından kurulacak` };
  } catch (err) {
    return { name, status: 'fail', detail: `veritabanına sorulamadı: ${errMsg(err)}` };
  }
}

/** (a) Bağlantı rolünün pg-boss tablolarındaki yetkileri (pg-boss gönderir, alır, tamamlar, kuyruk açar). */
export async function checkConnectionRole(db: Db, schema: string): Promise<CheckResult> {
  const name = 'pgboss.role';
  const job = `${quoteIdent(schema)}.job`;
  const queue = `${quoteIdent(schema)}.queue`;
  try {
    const r = await one<Record<string, unknown>>(
      db,
      `select current_user::text as role, to_regclass($1) is not null as has_job, to_regclass($2) is not null as has_queue`,
      [job, queue],
    );
    if (!r.has_job || !r.has_queue) return { name, status: 'fail', detail: `'${schema}.job' ya da '${schema}.queue' yok (pg-boss kurulmadı)` };
    const p = await one<Record<string, boolean>>(
      db,
      `select has_table_privilege(current_user, $1, 'SELECT') as job_select, has_table_privilege(current_user, $1, 'INSERT') as job_insert,
              has_table_privilege(current_user, $1, 'UPDATE') as job_update, has_table_privilege(current_user, $1, 'DELETE') as job_delete,
              has_table_privilege(current_user, $2, 'SELECT') as queue_select, has_table_privilege(current_user, $2, 'INSERT') as queue_insert,
              has_table_privilege(current_user, $2, 'UPDATE') as queue_update`,
      [job, queue],
    );
    const missing = Object.entries(p).filter(([, v]) => !v).map(([k]) => k.replace('_', ' ').toUpperCase());
    if (missing.length > 0) return { name, status: 'fail', detail: `bağlantı rolü ${String(r.role)} yetkisiz: ${missing.join(', ')}` };
    return { name, status: 'ok', detail: `rol ${String(r.role)}: ${schema}.job ve ${schema}.queue üzerinde gerekli yetkiler var` };
  } catch (err) {
    return { name, status: 'fail', detail: `yetkiler okunamadı: ${errMsg(err)}` };
  }
}

/** (c) Gerekli kuyruklar var mı; eksikleri açar. */
export async function checkQueues(names: readonly string[], ops: QueueOps): Promise<CheckResult> {
  const name = 'pgboss.queues';
  const created: string[] = [];
  const failed: string[] = [];
  for (const q of [...new Set(names)]) {
    try {
      if (await ops.exists(q)) continue;
      await ops.create(q);
      if (await ops.exists(q)) created.push(q);
      else failed.push(`${q} (açıldıktan sonra yok)`);
    } catch (err) {
      failed.push(`${q} (${errMsg(err)})`);
    }
  }
  if (failed.length > 0) return { name, status: 'fail', detail: `kuyruk açılamadı: ${failed.join(', ')}` };
  if (created.length > 0) return { name, status: 'fixed', detail: `eksik kuyruklar açıldı: ${created.join(', ')}` };
  return { name, status: 'ok', detail: `${new Set(names).size} kuyruk var` };
}

interface FnInfo {
  secdef: boolean;
  owner: string;
  executable: boolean;
}

async function enqueueFunction(db: Db): Promise<FnInfo | null> {
  const r = await db.query(
    `select p.prosecdef as secdef, pg_get_userbyid(p.proowner)::text as owner,
            has_function_privilege(current_user, p.oid, 'EXECUTE') as executable
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'enqueue_job' and pg_get_function_identity_arguments(p.oid) = 'p_name text, p_data jsonb'`,
  );
  const row = r.rows[0];
  return row ? { secdef: row.secdef === true, owner: String(row.owner), executable: row.executable === true } : null;
}

async function definerPrivileges(db: Db, role: string): Promise<string[]> {
  const p = await one<Record<string, boolean>>(
    db,
    `select has_schema_privilege($1, 'pgboss', 'USAGE') as schema_usage,
            has_table_privilege($1, 'pgboss.queue', 'SELECT') as queue_select,
            has_table_privilege($1, 'pgboss.job', 'SELECT') as job_select,
            has_table_privilege($1, 'pgboss.job', 'INSERT') as job_insert`,
    [role],
  );
  return Object.entries(p).filter(([, v]) => !v).map(([k]) => k.replace('_', ' ').toUpperCase());
}

/** Deneme: geri alınan bir DO bloğunda enqueue_job('startup.probe') pgboss.job'a yazar mı (sonuç hata metninde döner). */
export const PROBE_SQL = `do $probe$
declare
  v_id uuid;
  v_ok boolean;
  v_reason text;
begin
  v_id := public.enqueue_job('${PROBE_QUEUE}', jsonb_build_object('probe', true));
  v_ok := v_id is not null and exists (select 1 from pgboss.job j where j.id = v_id and j.name = '${PROBE_QUEUE}');
  begin
    if to_regclass('secure.job_outbox') is not null then
      execute 'select reason from secure.job_outbox where name = $1 order by created_at desc limit 1' into v_reason using '${PROBE_QUEUE}';
    end if;
  exception when others then
    v_reason := null;
  end;
  raise exception using errcode = 'P0001', message = format('OGR-PROBE %s %s', case when v_ok then 'ok' else 'fail' end, coalesce(v_reason, ''));
end
$probe$`;

/** DO bloğunun hata metnini çözer: geri alma kasıtlıdır, sonuç mesajdadır. */
export function parseProbe(err: unknown): { ok: boolean; reason: string } {
  const msg = errMsg(err);
  const m = /OGR-PROBE (ok|fail) ?(.*)$/s.exec(msg);
  if (!m) return { ok: false, reason: msg };
  return { ok: m[1] === 'ok', reason: (m[2] ?? '').trim() };
}

/**
 * (b) enqueue_job pgboss.job'a yazabiliyor mu. Şema 'pgboss' değilse (yalnız testler) atlanır: SQL tarafı şemayı sabit
 * kullanır.
 */
export async function checkEnqueueJob(db: Db, schema: string, grant: 'auto' | 'off', log?: Logger): Promise<CheckResult> {
  const name = 'enqueue_job';
  if (schema !== 'pgboss') return { name, status: 'skip', detail: `PGBOSS_SCHEMA='${schema}': SQL enqueue_job yalnız 'pgboss' şemasına yazar (test kipi)` };
  let fn: FnInfo | null;
  try {
    fn = await enqueueFunction(db);
  } catch (err) {
    return { name, status: 'fail', detail: `public.enqueue_job okunamadı: ${errMsg(err)}` };
  }
  if (!fn) return { name, status: 'fail', detail: 'public.enqueue_job(text, jsonb) yok (supabase göçleri uygulanmadı)' };

  let fixed = '';
  if (fn.secdef) {
    let missing: string[];
    try {
      missing = await definerPrivileges(db, fn.owner);
    } catch (err) {
      return { name, status: 'fail', detail: `enqueue_job sahibi ${fn.owner} için yetkiler okunamadı: ${errMsg(err)}` };
    }
    if (missing.length > 0) {
      const owner = quoteIdent(fn.owner);
      const grantSql = `grant usage on schema pgboss to ${owner}; grant select on pgboss.queue to ${owner}; grant select, insert on pgboss.job to ${owner}`;
      if (grant === 'off') {
        return { name, status: 'fail', detail: `enqueue_job SECURITY DEFINER sahibi ${fn.owner} pgboss'ta yetkisiz (${missing.join(', ')}); SQL'den atılan işler outbox'a düşer. Worker'ı ${fn.owner} ile bağla ya da çalıştır: ${grantSql}` };
      }
      try {
        await db.query(grantSql);
        const still = await definerPrivileges(db, fn.owner);
        if (still.length > 0) throw new Error(`yetki verildi ama eksik: ${still.join(', ')}`);
        fixed = `${fn.owner} için pgboss yetkileri verildi (${missing.join(', ')})`;
        log?.warn('enqueue_job sahibine pgboss yetkisi verildi', { owner: fn.owner, missing });
      } catch (err) {
        return { name, status: 'fail', detail: `enqueue_job SECURITY DEFINER sahibi ${fn.owner} pgboss'ta yetkisiz (${missing.join(', ')}) ve bu bağlantı yetki veremedi (${errMsg(err)}). Worker'ı pgboss'u kuran rolle ('postgres') bağla ya da şema sahibi çalıştırsın: ${grantSql}` };
      }
    }
  }

  if (!fn.executable) {
    return fixed
      ? { name, status: 'fixed', detail: `${fixed}; deneme atlandı (bağlantı rolünün EXECUTE yetkisi yok)` }
      : { name, status: 'warn', detail: `sahip ${fn.owner} yetkili; deneme atlandı (bağlantı rolünün enqueue_job EXECUTE yetkisi yok)` };
  }
  try {
    await db.query(PROBE_SQL);
    return { name, status: 'fail', detail: 'deneme bloğu beklenen sonucu döndürmedi' };
  } catch (err) {
    const probe = parseProbe(err);
    if (!probe.ok) return { name, status: 'fail', detail: `enqueue_job('${PROBE_QUEUE}') pgboss.job'a yazamadı: ${probe.reason || 'neden yok'}` };
  }
  return { name, status: fixed ? 'fixed' : 'ok', detail: `${fixed ? `${fixed}; ` : ''}enqueue_job('${PROBE_QUEUE}') pgboss.job'a yazdı (geri alındı; sahip ${fn.owner})` };
}

/**
 * secure.job_outbox (0029) aktarılabilir mi. Tablo yoksa yalnız uyarı (eski veritabanı; outbox.drain kapalı). Tablo
 * varsa aktarım zorunludur: enqueue_job (sahibi RLS'yi atlar) satır yazmaya devam eder, worker okuyamazsa işler sessizce
 * birikir. Tabloda ENABLE + FORCE RLS var ve politika yok; bu yüzden yetkilerin yanında bağlantı rolü süper kullanıcı
 * ya da BYPASSRLS olmalı (yoksa her sorgu 0 satır görür). Eksik yetki, RLS atlamayan rol ya da sorulamayan veritabanı
 * `fail` döner (strict → çıkış 78).
 */
export async function checkOutbox(db: Db): Promise<CheckResult & { available: boolean }> {
  const name = 'outbox';
  try {
    // to_regclass / ad ile has_table_privilege, şemada USAGE yoksa hata verir; katalogdan oid ile sorulur.
    const r = await one<{ outbox_oid: string | null; role: string; bypass: boolean }>(
      db,
      `select (select c.oid::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'secure' and c.relname = 'job_outbox' and c.relkind in ('r', 'p')) as outbox_oid,
              current_user::text as role,
              coalesce((select rolsuper or rolbypassrls from pg_roles where rolname = current_user), false) as bypass`,
    );
    if (!r.outbox_oid) return { name, status: 'warn', detail: 'secure.job_outbox yok (0029 uygulanmadı); outbox.drain kapalı', available: false };
    const p = await one<Record<string, boolean>>(
      db,
      `select has_schema_privilege(current_user, 'secure', 'USAGE') as schema_usage,
              has_table_privilege(current_user, $1::oid, 'SELECT') as select,
              has_table_privilege(current_user, $1::oid, 'UPDATE') as update,
              has_table_privilege(current_user, $1::oid, 'DELETE') as delete`,
      [r.outbox_oid],
    );
    const missing = Object.entries(p).filter(([, v]) => !v).map(([k]) => k.replace('_', ' ').toUpperCase());
    if (!r.bypass) missing.push('BYPASSRLS');
    if (missing.length > 0) {
      return {
        name,
        status: 'fail',
        detail:
          `rol ${r.role} secure.job_outbox'u aktaramaz (${missing.join(', ')}); SQL'den atılan işler outbox'ta birikir. ` +
          `Tabloda FORCE RLS var ve politika yok: worker'ı 'postgres' (ya da BYPASSRLS bir rol) ile bağla; ` +
          `yetkiler: grant usage on schema secure, select, update, delete on secure.job_outbox`,
        available: false,
      };
    }
    const c = await one<{ n: number }>(db, `select count(*)::int as n from secure.job_outbox`);
    return { name, status: 'ok', detail: `outbox okunabilir (${c.n} bekleyen iş)`, available: true };
  } catch (err) {
    return { name, status: 'fail', detail: `outbox denetlenemedi: ${errMsg(err)}`, available: false };
  }
}

/** pg-boss başladıktan sonraki denetimler: (a) rol, (c) kuyruklar, (b) enqueue_job, outbox. */
export async function runStartupChecks(opts: {
  db: Db;
  schema: string;
  queues: readonly string[];
  ops: QueueOps;
  grant: 'auto' | 'off';
  log?: Logger;
  preflight?: CheckResult;
}): Promise<StartupReport> {
  const checks: CheckResult[] = [];
  if (opts.preflight) checks.push(opts.preflight);
  const role = await checkConnectionRole(opts.db, opts.schema);
  checks.push(role);
  if (role.status !== 'fail') {
    checks.push(await checkQueues([...opts.queues, PROBE_QUEUE], opts.ops));
    checks.push(await checkEnqueueJob(opts.db, opts.schema, opts.grant, opts.log));
  }
  const outbox = await checkOutbox(opts.db);
  checks.push({ name: outbox.name, status: outbox.status, detail: outbox.detail });
  return { ok: !checks.some((c) => c.status === 'fail'), checks, outbox: outbox.available };
}

/** Günlük ve sağlık için kısa özet. */
export function summarize(report: StartupReport): Record<string, string> {
  return Object.fromEntries(report.checks.map((c) => [c.name, c.status === 'ok' || c.status === 'skip' ? c.status : `${c.status}: ${c.detail}`]));
}
