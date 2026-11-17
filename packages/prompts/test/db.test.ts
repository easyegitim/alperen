import { describe, expect, it } from 'vitest';
import { createPromptResolver, PROMPT_VERSIONS_FLAG, readVersionSources, syncPromptVersions, type SqlQueryable } from '../src/db.js';
import { allPrompts } from '../src/index.js';

/** Bellek içi `prompt_versions` + `runtime_flags` (yalnız db.ts'nin gönderdiği sorgular). */
class FakeDb implements SqlQueryable {
  flags = new Map<string, unknown>();
  rows: { route: string; version: string; system_text: string; schema_name: string | null; model: string; effort: string; active: boolean }[] = [];
  calls = 0;
  fail = false;
  async query(text: string, values: unknown[] = []) {
    this.calls += 1;
    if (this.fail) throw new Error('bağlantı yok');
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('select value from public.runtime_flags')) {
      return { rows: this.flags.has(values[0] as string) ? [{ value: this.flags.get(values[0] as string) }] : [] };
    }
    if (sql.startsWith('select route, version from public.prompt_versions where active')) {
      return { rows: this.rows.filter((r) => r.active).map((r) => ({ route: r.route, version: r.version })) };
    }
    if (sql.startsWith('insert into public.prompt_versions')) {
      const [route, version, system_text, schema_name, model, effort] = values as [string, string, string, string | null, string, string];
      if (this.rows.some((r) => r.route === route && r.version === version)) return { rows: [] };
      this.rows.push({ route, version, system_text, schema_name, model, effort, active: false });
      return { rows: [{ id: this.rows.length }] };
    }
    if (sql.startsWith('select system_text')) {
      return { rows: this.rows.filter((r) => r.route === values[0] && r.version === values[1]) };
    }
    throw new Error(`beklenmeyen sorgu: ${sql}`);
  }
}

describe('veritabanı köprüsü', () => {
  it('sabitleme ve etkin satırları okur; geçersiz değerleri atar', async () => {
    const db = new FakeDb();
    db.flags.set(PROMPT_VERSIONS_FLAG, { coach_chat: 'v2', bozuk: 3, kotu: 'sürüm' });
    db.rows.push({ route: 'solution_diagnosis', version: 'v1', system_text: 'x', schema_name: null, model: 'm', effort: 'high', active: true });
    expect(await readVersionSources(db)).toEqual({ pinned: { coach_chat: 'v2' }, active: { solution_diagnosis: 'v1' } });
    db.flags.set(PROMPT_VERSIONS_FLAG, ['dizi']);
    expect((await readVersionSources(db)).pinned).toEqual({});
  });

  it('eşitleme ekler, aynıysa dokunmaz, metin değiştiyse sapma bildirir ve satırı ezmez', async () => {
    const db = new FakeDb();
    const prompts = allPrompts();
    const first = await syncPromptVersions(db, prompts);
    expect(first.inserted).toHaveLength(prompts.length);
    expect(db.rows.every((r) => !r.active)).toBe(true);
    const sd = db.rows.find((r) => r.route === 'solution_diagnosis');
    expect(sd).toMatchObject({ schema_name: 'solution-diagnosis', model: 'claude-opus-5-5', effort: 'high' });
    const second = await syncPromptVersions(db, prompts);
    expect(second).toEqual({ inserted: [], unchanged: first.inserted, drifted: [] });
    if (sd) sd.system_text = 'elle değiştirilmiş';
    const third = await syncPromptVersions(db, prompts);
    expect(third.drifted).toEqual(['solution_diagnosis@v1']);
    expect(sd?.system_text).toBe('elle değiştirilmiş');
  });

  it('çözücü kaynakları önbellekler, hata olursa son bilinenle devam eder', async () => {
    const db = new FakeDb();
    db.flags.set(PROMPT_VERSIONS_FLAG, { coach_chat: 'v1' });
    let t = 0;
    const errors: unknown[] = [];
    const r = createPromptResolver(db, { ttlMs: 1000, now: () => t, onError: (e) => errors.push(e) });
    expect((await r.load('coach_chat')).selection.source).toBe('pinned');
    const calls = db.calls;
    await r.load('coach_chat');
    expect(db.calls).toBe(calls);
    t = 2000;
    db.fail = true;
    expect((await r.load('coach_chat')).selection.source).toBe('pinned');
    expect(errors).toHaveLength(1);
    r.invalidate();
    const fresh = createPromptResolver(db, { onError: () => undefined });
    expect((await fresh.load('coach_chat')).selection.source).toBe('default');
  });
});
