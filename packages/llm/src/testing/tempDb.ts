/**
 * YALNIZ TESTLER: yerel Postgres'te geçici bir v2 veritabanı kurar (supabase/scripts/db-test.sh ile aynı sıra):
 *   tests/00_local_stub.sql (süper kullanıcıyla) → migrations/*.sql → seed/*.sql (migration sahibi ogrenmen_owner rolüyle)
 *   → isteğe bağlı TYT müfredat seed'i (content/tyt-matematik/scripts/export-sql.py --schema v2).
 * Bağlanılan veritabanına dokunmaz; ad `ogrenmen_t_<rastgele>`; `drop()` siler. 'ogrenmen' adı asla kullanılmaz.
 * Kullanım: packages/llm ve apps/worker `*.db.test.ts` (OGRENMEN_LIVE=1, check.sh).
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
  python?: string;
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
  const supa = join(REPO_ROOT, 'supabase');
  const drop = async () => {
    const a = new pg.Client({ connectionString: base });
    await a.connect();
    try {
      await a.query(`drop database if exists "${name}" with (force)`);
    } finally {
      await a.end();
    }
  };
  let curriculumId: string | null = null;
  try {
    await runFile(url, join(supa, 'tests', '00_local_stub.sql'), null);
    for (const f of readdirSync(join(supa, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
      await runFile(url, join(supa, 'migrations', f), MIGRATION_ROLE);
    }
    for (const f of readdirSync(join(supa, 'seed')).filter((x) => x.endsWith('.sql')).sort()) {
      await runFile(url, join(supa, 'seed', f), MIGRATION_ROLE);
    }
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
    }
  } catch (err) {
    await drop().catch(() => undefined);
    throw err;
  }
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  return {
    name,
    url,
    pool,
    curriculumId,
    async drop() {
      await pool.end().catch(() => undefined);
      await drop();
    },
  };
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
