/**
 * YALNIZ TESTLER VE YEREL DENEME: yerel Postgres'te v2 veritabanı kurar (supabase/scripts/db-test.sh ile aynı sıra):
 *   tests/00_local_stub.sql (süper kullanıcıyla) → migrations/*.sql → seed/*.sql (migration sahibi ogrenmen_owner rolüyle)
 *   → isteğe bağlı TYT müfredat seed'i (content/tyt-matematik/scripts/export-sql.py --schema v2)
 *   → isteğe bağlı TYT cevap anahtarları (content/tyt-matematik/scripts/seed-keys.py --schema v2).
 * `createTempDatabase`: geçici ad `ogrenmen_t_<rastgele>`; `drop()` siler (packages/llm ve apps/worker `*.db.test.ts`,
 * OGRENMEN_LIVE=1, check.sh; apps/web yolculuk yığını).
 * `createDatabase({ name, persistent: true })`: kalıcı ad (kurucunun yerel denemesi, scripts/dev-local/up.ts): yoksa kurar,
 * varsa dokunmaz; yalnız henüz uygulanmamış göçleri uygular (kayıt: `public.__dev_migrations`).
 * Bağlanılan veritabanına dokunmaz; 'ogrenmen' adı asla kullanılmaz.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const DEFAULT_BASE_URL = 'postgresql://ogrenmen:ogrenmen@127.0.0.1:5432/ogrenmen';
export const MIGRATION_ROLE = 'ogrenmen_owner';
/** Depo kökü (packages/llm/src/testing → ../../../..). */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export interface TempDatabase {
  name: string;
  url: string;
  /** Süper kullanıcı (bağlanan kullanıcı) havuzu; RLS FORCE tablolarında sahip rolü gerekmez. */
  pool: pg.Pool;
  /** TYT müfredat seed'i uygulandıysa müfredat kimliği. */
  curriculumId: string | null;
  /** Havuzu kapatır; veritabanı kalır. */
  close(): Promise<void>;
  /** Havuzu kapatır ve veritabanını siler. */
  drop(): Promise<void>;
}

function withDb(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function runFile(url: string, file: string, role: string | null): Promise<void> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    if (role) await c.query(`set role ${role}`);
    await c.query(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file}: ${(err as Error).message}`);
  } finally {
    await c.end();
  }
}

export interface TempDatabaseOptions {
  baseUrl?: string;
  /** TYT müfredat seed'i (python3 + export-sql.py gerekir). Varsayılan true. */
  content?: boolean;
  /** TYT cevap anahtarları (python3 + seed-keys.py --schema v2; content gerekir). Varsayılan false. */
  answerKeys?: boolean;
  /** Atlanacak seed dosyaları (ör. ['00_people.sql']: deneme kişileri olmadan). */
  skipSeeds?: string[];
  python?: string;
}

export interface DatabaseOptions extends TempDatabaseOptions {
  /** Veritabanı adı (küçük harf, rakam, alt çizgi). 'ogrenmen' ve sistem adları reddedilir. */
  name: string;
  /** true: varsa dokunulmaz (yalnız yeni göçler), drop() yalnız açıkça çağrılınca. */
  persistent?: boolean;
}

export interface PersistentDatabase extends TempDatabase {
  /** Bu çağrıda sıfırdan kuruldu mu. */
  created: boolean;
  /** Var olan veritabanına bu çağrıda uygulanan yeni göçler (dosya adları). */
  appliedMigrations: string[];
  /** İçeriği kurulumdan sonra değişmiş göçler (yeniden uygulanmaz; sıfırlama önerilir). */
  changedMigrations: string[];
}

/** Kalıcı veritabanında uygulanan göçlerin kaydı (yalnız yerel; RLS açık, hiçbir role izin yok). */
export const DEV_MIGRATIONS_TABLE = 'public.__dev_migrations';
const RESERVED_NAMES = new Set(['ogrenmen', 'postgres', 'template0', 'template1']);

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const migrationFiles = (supa: string) => readdirSync(join(supa, 'migrations')).filter((x) => x.endsWith('.sql')).sort();

async function databaseExists(base: string, name: string): Promise<boolean> {
  const c = new pg.Client({ connectionString: base });
  await c.connect();
  try {
    return ((await c.query('select 1 from pg_database where datname = $1', [name])).rowCount ?? 0) > 0;
  } finally {
    await c.end();
  }
}

async function dropDatabase(base: string, name: string): Promise<void> {
  const a = new pg.Client({ connectionString: base });
  await a.connect();
  try {
    await a.query(`drop database if exists "${name}" with (force)`);
  } finally {
    await a.end();
  }
}

/** Boş veritabanına stub + göçler + seed (+ müfredat, + anahtarlar). Döner: müfredat kimliği. */
async function provision(url: string, opts: TempDatabaseOptions, recordMigrations: boolean): Promise<string | null> {
  const supa = join(REPO_ROOT, 'supabase');
  await runFile(url, join(supa, 'tests', '00_local_stub.sql'), null);
  for (const f of migrationFiles(supa)) {
    await runFile(url, join(supa, 'migrations', f), MIGRATION_ROLE);
  }
  const skip = new Set(opts.skipSeeds ?? []);
  for (const f of readdirSync(join(supa, 'seed')).filter((x) => x.endsWith('.sql') && !skip.has(x)).sort()) {
    await runFile(url, join(supa, 'seed', f), MIGRATION_ROLE);
  }
  let curriculumId: string | null = null;
  if (opts.content !== false) {
    const dir = mkdtempSync(join(tmpdir(), 'ogrenmen-cur-'));
    try {
      const out = join(dir, 'curriculum.sql');
      execFileSync(opts.python ?? 'python3', [join(REPO_ROOT, 'content', 'tyt-matematik', 'scripts', 'export-sql.py'), '--schema', 'v2', '--out', out], { stdio: 'pipe' });
      await runFile(url, out, MIGRATION_ROLE);
      const m = /insert into public\.curricula \(id,[^)]*\) values \('([0-9a-f-]{36})'/.exec(readFileSync(out, 'utf8'));
      curriculumId = m?.[1] ?? null;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (opts.answerKeys) {
      execFileSync(opts.python ?? 'python3', [join(REPO_ROOT, 'content', 'tyt-matematik', 'scripts', 'seed-keys.py'), '--schema', 'v2', '--database-url', url], {
        stdio: 'pipe',
        env: { ...process.env, PGOPTIONS: `-c role=${MIGRATION_ROLE}` },
      });
    }
  }
  if (recordMigrations) {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    try {
      await c.query(`create table if not exists ${DEV_MIGRATIONS_TABLE} (name text primary key, sha256 text not null, applied_at timestamptz not null default now())`);
      await c.query(`alter table ${DEV_MIGRATIONS_TABLE} enable row level security`);
      await c.query(`revoke all on ${DEV_MIGRATIONS_TABLE} from public, anon, authenticated, service_role`);
      for (const f of migrationFiles(supa)) {
        await c.query(`insert into ${DEV_MIGRATIONS_TABLE} (name, sha256) values ($1, $2) on conflict (name) do nothing`, [f, sha256(join(supa, 'migrations', f))]);
      }
    } finally {
      await c.end();
    }
  }
  return curriculumId;
}

/** Var olan kalıcı veritabanı: kayıtta olmayan göçleri sırayla, her birini tek işlemde uygular. */
async function migrateExisting(url: string): Promise<{ applied: string[]; changed: string[]; curriculumId: string | null }> {
  const supa = join(REPO_ROOT, 'supabase');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const has = (await c.query(`select to_regclass($1) is not null as ok`, [DEV_MIGRATIONS_TABLE])).rows[0]?.ok;
    if (!has) {
      throw new Error(`${DEV_MIGRATIONS_TABLE} tablosu yok: bu veritabanı yerel deneme betiğiyle kurulmamış (sıfırlamak için --reset)`);
    }
    const done = new Map<string, string>((await c.query(`select name, sha256 from ${DEV_MIGRATIONS_TABLE}`)).rows.map((r) => [r.name as string, r.sha256 as string]));
    const applied: string[] = [];
    const changed: string[] = [];
    for (const f of migrationFiles(supa)) {
      const file = join(supa, 'migrations', f);
      const sum = sha256(file);
      if (done.has(f)) {
        if (done.get(f) !== sum) changed.push(f);
        continue;
      }
      try {
        await c.query('begin');
        await c.query(`set local role ${MIGRATION_ROLE}`);
        await c.query(readFileSync(file, 'utf8'));
        await c.query('reset role');
        await c.query(`insert into ${DEV_MIGRATIONS_TABLE} (name, sha256) values ($1, $2)`, [f, sum]);
        await c.query('commit');
      } catch (err) {
        await c.query('rollback').catch(() => undefined);
        throw new Error(`${file}: ${(err as Error).message}`);
      }
      applied.push(f);
    }
    const cur = await c.query(`select id::text from public.curricula where origin = 'seed' order by created_at limit 1`).catch(() => ({ rows: [] as { id: string }[] }));
    return { applied, changed, curriculumId: (cur.rows[0] as { id: string } | undefined)?.id ?? null };
  } finally {
    await c.end();
  }
}

function makeHandle(base: string, name: string, url: string, curriculumId: string | null): TempDatabase {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  return {
    name,
    url,
    pool,
    curriculumId,
    async close() {
      await pool.end().catch(() => undefined);
    },
    async drop() {
      await pool.end().catch(() => undefined);
      await dropDatabase(base, name);
    },
  };
}

export async function createTempDatabase(opts: TempDatabaseOptions = {}): Promise<TempDatabase> {
  const base = opts.baseUrl ?? process.env.OGRENMEN_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_BASE_URL;
  const name = `ogrenmen_t_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = withDb(base, name);
  let curriculumId: string | null = null;
  try {
    curriculumId = await provision(url, opts, false);
  } catch (err) {
    await dropDatabase(base, name).catch(() => undefined);
    throw err;
  }
  return makeHandle(base, name, url, curriculumId);
}

/**
 * Adlandırılmış veritabanı. `persistent: false` (varsayılan) createTempDatabase gibi her seferinde kurar (ad varsa hata).
 * `persistent: true`: yoksa kurar ve göçleri `public.__dev_migrations`'a kaydeder; varsa yalnız eksik göçleri uygular.
 * İlk kurulum yarıda kalırsa veritabanı silinir (bir sonraki çağrı temiz başlar).
 */
export async function createDatabase(opts: DatabaseOptions): Promise<PersistentDatabase> {
  const base = opts.baseUrl ?? process.env.OGRENMEN_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_BASE_URL;
  const name = opts.name;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name) || RESERVED_NAMES.has(name)) throw new Error(`geçersiz ya da korunan veritabanı adı: ${name}`);
  if (new URL(base).pathname.replace(/^\//, '') === name) throw new Error(`hedef veritabanı (${name}) bağlanılan veritabanıyla aynı olamaz`);
  const url = withDb(base, name);
  if (opts.persistent && (await databaseExists(base, name))) {
    const { applied, changed, curriculumId } = await migrateExisting(url);
    return { ...makeHandle(base, name, url, curriculumId), created: false, appliedMigrations: applied, changedMigrations: changed };
  }
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  let curriculumId: string | null = null;
  try {
    curriculumId = await provision(url, opts, Boolean(opts.persistent));
  } catch (err) {
    await dropDatabase(base, name).catch(() => undefined);
    throw err;
  }
  return { ...makeHandle(base, name, url, curriculumId), created: true, appliedMigrations: [], changedMigrations: [] };
}

/** Adlandırılmış veritabanını siler (yoksa bir şey yapmaz). Korunan adlar reddedilir. */
export async function dropDatabaseByName(name: string, baseUrl?: string): Promise<void> {
  const base = baseUrl ?? process.env.OGRENMEN_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_BASE_URL;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name) || RESERVED_NAMES.has(name)) throw new Error(`geçersiz ya da korunan veritabanı adı: ${name}`);
  if (new URL(base).pathname.replace(/^\//, '') === name) throw new Error(`bağlanılan veritabanı silinemez: ${name}`);
  await dropDatabase(base, name);
}

/** Seed'deki deneme öğrencisi (Elif) ve ikinci öğrenci (Can): profiles e1/e2 → students.id. */
export async function seedStudents(db: pg.Pool): Promise<{ elif: string; can: string; elifRef: string }> {
  const r = await db.query(
    `select s.id, s.public_ref, s.profile_id from public.students s
      where s.profile_id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2') order by s.profile_id`,
  );
  const [e1, e2] = r.rows as { id: string; public_ref: string }[];
  if (!e1 || !e2) throw new Error('seed öğrencileri yok (supabase/seed/00_people.sql)');
  return { elif: e1.id, can: e2.id, elifRef: e1.public_ref };
}
