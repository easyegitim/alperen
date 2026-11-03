/**
 * Canlı: geçici bir veritabanında, migration'lardaki gerçek DDL ile `runtime_flags` ve `prompt_versions` kurulur;
 * eşitleme, sapma ve sürüm kaynakları uçtan uca denenir. Bağlanılan veritabanına dokunulmaz; geçici veritabanı
 * test sonunda silinir. OGRENMEN_DATABASE_URL gerekir (check.sh canlı kipte yerel varsayılanı verir).
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROMPT_VERSIONS_FLAG, readVersionSources, syncPromptVersions } from '../src/db.js';
import { allPrompts, loadPrompt } from '../src/index.js';

const URL_ = process.env.OGRENMEN_DATABASE_URL ?? '';
const DB = `ogrenmen_prompts_test_${process.pid}`;
const migration = (f: string) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8');

/** `create table public.<ad> (…);` bloğunu migration dosyasından aynen alır. */
function tableDdl(file: string, table: string): string {
  const m = new RegExp(`create table public\\.${table} \\([\\s\\S]*?\\n\\);`).exec(migration(file));
  if (!m) throw new Error(`${file}: ${table} DDL bulunamadı`);
  return m[0];
}

let admin: pg.Client;
let db: pg.Client;

beforeAll(async () => {
  if (!URL_) throw new Error('OGRENMEN_DATABASE_URL gerekli');
  admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  await admin.query(`drop database if exists ${DB}`);
  await admin.query(`create database ${DB}`);
  const u = new URL(URL_);
  u.pathname = `/${DB}`;
  db = new pg.Client({ connectionString: u.toString() });
  await db.connect();
  await db.query(tableDdl('0003_identity.sql', 'runtime_flags'));
  await db.query(tableDdl('0014_llm_ledger.sql', 'prompt_versions'));
  const idx = /create unique index prompt_versions_one_active[^;]*;/.exec(migration('0014_llm_ledger.sql'));
  if (!idx) throw new Error('prompt_versions_one_active dizini bulunamadı');
  await db.query(idx[0]);
});

afterAll(async () => {
  await db?.end();
  if (admin) {
    await admin.query(`drop database if exists ${DB}`);
    await admin.end();
  }
});

describe('prompt_versions eşitlemesi (canlı Postgres)', () => {
  it('ekler, ikinci koşuda dokunmaz, sapmayı bildirir; kaynaklar seçime yansır', async () => {
    const prompts = allPrompts();
    const first = await syncPromptVersions(db, prompts);
    expect(first.inserted).toHaveLength(prompts.length);
    expect(await syncPromptVersions(db, prompts)).toEqual({ inserted: [], unchanged: first.inserted, drifted: [] });

    await db.query(`update public.prompt_versions set system_text = system_text || ' ' where route = 'parent_chat'`);
    expect((await syncPromptVersions(db, prompts)).drifted).toEqual(['parent_chat@v1']);

    await db.query(`update public.prompt_versions set active = true where route = 'coach_chat' and version = 'v1'`);
    await db.query(`insert into public.runtime_flags (key, value) values ($1, $2::jsonb)`, [
      PROMPT_VERSIONS_FLAG,
      JSON.stringify({ solution_diagnosis: 'v1', memory_delta: 'v9' }),
    ]);
    const sources = await readVersionSources(db);
    expect(sources).toEqual({ pinned: { solution_diagnosis: 'v1', memory_delta: 'v9' }, active: { coach_chat: 'v1' } });
    expect(loadPrompt('coach_chat', { sources }).selection.source).toBe('active');
    expect(loadPrompt('solution_diagnosis', { sources }).selection.source).toBe('pinned');
    expect(loadPrompt('memory_delta', { sources }).selection).toMatchObject({ source: 'default', ignored: [{ source: 'pinned', version: 'v9' }] });

    const row = await db.query(`select system_text, schema_name, model, effort from public.prompt_versions where route = 'solution_diagnosis'`);
    expect(row.rows[0]).toEqual({ system_text: loadPrompt('solution_diagnosis').text, schema_name: 'solution-diagnosis', model: 'claude-opus-5-5', effort: 'high' });
  });
});
