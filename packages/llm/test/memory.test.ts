import { describe, expect, it } from 'vitest';
import {
  assertMemoryPath,
  createMemoryHandlers,
  InMemoryStore,
  MEMORY_MAX_BYTES,
  MemoryError,
  PgStore,
  runMemoryCommand,
  type PgClientLike,
  type PgPoolLike,
} from '../src/memory/pgMemory.js';

const SID = '11111111-1111-4111-8111-111111111111';

function mk(opts: { readOnly?: boolean } = {}) {
  const store = new InMemoryStore(() => new Date('2026-11-02T09:00:00Z'));
  const h = createMemoryHandlers({ store, studentId: SID, actor: 'coach', ...opts });
  return { store, h };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof MemoryError ? e.code : `other:${String(e)}`;
  }
};

describe('hafıza yolu izin listesi', () => {
  it.each([
    '/memories/profile.md',
    '/memories/courses/tyt-mat.md',
    '/memories/a_b-c.d',
  ])('geçerli: %s', (p) => expect(assertMemoryPath(p)).toBe(p));

  it.each([
    '/etc/passwd',
    '/memories',
    '/memories/../x.md',
    '/memories/a/../../b',
    '/memories//a.md',
    'memories/a.md',
    '/memories/a b.md',
    '/memories/%2e%2e/a',
    '/memories/a\\b',
    '/memories/ç.md',
    '/memories/./a.md',
    `/memories/${'a'.repeat(250)}`,
  ])('reddedilir: %s', (p) => expect(() => assertMemoryPath(p)).toThrow(MemoryError));

  it('view kökü kabul eder', () => expect(assertMemoryPath('/memories', { allowRoot: true })).toBe('/memories'));
});

describe('hafıza işleyicileri', () => {
  it('create → view (satır numaralı) → str_replace → insert → rename → delete; sürümler', async () => {
    const { store, h } = mk();
    expect(await h.create({ command: 'create', path: '/memories/patterns.md', file_text: 'a\nb\nc' })).toContain('created');
    expect(await h.view({ command: 'view', path: '/memories/patterns.md' })).toContain('     2\tb');
    expect(await h.view({ command: 'view', path: '/memories/patterns.md', view_range: [2, 3] })).not.toContain('\ta\n');
    await h.str_replace({ command: 'str_replace', path: '/memories/patterns.md', old_str: 'b', new_str: 'B' });
    await h.insert({ command: 'insert', path: '/memories/patterns.md', insert_line: 0, insert_text: 'başlık' });
    expect(await store.read(SID, '/memories/patterns.md')).toBe('başlık\na\nB\nc');
    await h.rename({ command: 'rename', old_path: '/memories/patterns.md', new_path: '/memories/p2.md' });
    expect(await store.read(SID, '/memories/patterns.md')).toBeNull();
    const dir = await h.view({ command: 'view', path: '/memories' });
    expect(dir).toContain('/memories/p2.md');
    await h.delete({ command: 'delete', path: '/memories/p2.md' });
    expect(store.versions.map((v) => v.op)).toEqual(['create', 'str_replace', 'insert', 'rename', 'delete']);
    expect(store.versions.every((v) => v.actor === 'coach')).toBe(true);
  });

  it('dosya ≤ 8 KB (UTF-8 bayt)', async () => {
    const { h } = mk();
    expect(await code(Promise.resolve(h.create({ command: 'create', path: '/memories/a.md', file_text: 'x'.repeat(MEMORY_MAX_BYTES) })))).toBeNull();
    // 'ş' iki bayt: 4097 karakter = 8194 bayt
    expect(await code(Promise.resolve(h.create({ command: 'create', path: '/memories/b.md', file_text: 'ş'.repeat(4097) })))).toBe('OGR-MEM-002');
    // düzenleme sınırı aşarsa da reddedilir
    expect(await code(Promise.resolve(h.insert({ command: 'insert', path: '/memories/a.md', insert_line: 1, insert_text: 'y' })))).toBe('OGR-MEM-002');
  });

  it('öğrenci başına ≤ 12 dosya; mevcut dosyanın üzerine yazmak sayılmaz', async () => {
    const { h } = mk();
    for (let i = 0; i < 12; i++) await h.create({ command: 'create', path: `/memories/f${i}.md`, file_text: 'x' });
    expect(await code(Promise.resolve(h.create({ command: 'create', path: '/memories/f12.md', file_text: 'x' })))).toBe('OGR-MEM-001');
    expect(await code(Promise.resolve(h.create({ command: 'create', path: '/memories/f3.md', file_text: 'yeni' })))).toBeNull();
  });

  it('str_replace tek eşleşme ister', async () => {
    const { h } = mk();
    await h.create({ command: 'create', path: '/memories/a.md', file_text: 'x x' });
    expect(await code(Promise.resolve(h.str_replace({ command: 'str_replace', path: '/memories/a.md', old_str: 'x', new_str: 'y' })))).toBe('OGR-MEM-022');
    expect(await code(Promise.resolve(h.str_replace({ command: 'str_replace', path: '/memories/a.md', old_str: 'z', new_str: 'y' })))).toBe('OGR-MEM-021');
    expect(await code(Promise.resolve(h.str_replace({ command: 'str_replace', path: '/memories/yok.md', old_str: 'z', new_str: 'y' })))).toBe('OGR-MEM-017');
  });

  it('insert satır aralığı; rename hedefi varsa reddedilir', async () => {
    const { h } = mk();
    await h.create({ command: 'create', path: '/memories/a.md', file_text: 'l1\nl2' });
    await h.create({ command: 'create', path: '/memories/b.md', file_text: '' });
    expect(await code(Promise.resolve(h.insert({ command: 'insert', path: '/memories/a.md', insert_line: 3, insert_text: 'x' })))).toBe('OGR-MEM-023');
    expect(await code(Promise.resolve(h.rename({ command: 'rename', old_path: '/memories/a.md', new_path: '/memories/b.md' })))).toBe('OGR-MEM-025');
  });

  it('yol dışına kaçış reddedilir (tüm komutlarda)', async () => {
    const { h } = mk();
    expect(await code(Promise.resolve(h.create({ command: 'create', path: '/memories/../secret', file_text: 'x' })))).toBe('OGR-MEM-013');
    expect(await code(Promise.resolve(h.view({ command: 'view', path: '/etc' })))).toBe('OGR-MEM-012');
    expect(await code(Promise.resolve(h.rename({ command: 'rename', old_path: '/memories/a', new_path: '/tmp/a' })))).toBe('OGR-MEM-012');
  });

  it('salt okunur bağlamda yazma reddedilir', async () => {
    const { h } = mk({ readOnly: true });
    expect(await code(Promise.resolve(h.create({ command: 'create', path: '/memories/a.md', file_text: 'x' })))).toBe('OGR-MEM-016');
    expect(await h.view({ command: 'view', path: '/memories' })).toContain('0/12');
  });

  it('dizin silme ve bilinmeyen komut', async () => {
    const { h, store } = mk();
    await h.create({ command: 'create', path: '/memories/courses/a.md', file_text: 'x' });
    await h.create({ command: 'create', path: '/memories/courses/b.md', file_text: 'y' });
    expect(await h.delete({ command: 'delete', path: '/memories/courses' })).toContain('2 files');
    expect(await store.list(SID)).toEqual([]);
    expect(await code(runMemoryCommand(h, { command: 'zap', path: '/memories/a' } as never))).toBe('OGR-MEM-026');
  });
});

describe('PgStore', () => {
  function fakePool() {
    const log: { sql: string; values: unknown[] | undefined }[] = [];
    const rows = new Map<string, string>();
    const q = async (sql: string, values?: unknown[]) => {
      log.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
      if (sql.startsWith('select content')) {
        const c = rows.get(String(values?.[1]));
        return { rows: c === undefined ? [] : [{ content: c }] };
      }
      if (sql.includes('insert into public.memory_files')) rows.set(String(values?.[1]), String(values?.[2]));
      if (sql.startsWith('update public.memory_files')) {
        const c = rows.get(String(values?.[1]));
        rows.delete(String(values?.[1]));
        if (c !== undefined) rows.set(String(values?.[2]), c);
        return { rows: c === undefined ? [] : [{ content: c }] };
      }
      return { rows: [] };
    };
    const client: PgClientLike = { query: q, release: () => undefined };
    const pool: PgPoolLike = { query: q, connect: async () => client };
    return { pool, log };
  }

  it('yazım tek işlemde dosya + sürüm satırı yazar', async () => {
    const { pool, log } = fakePool();
    const s = new PgStore(pool);
    await s.write(SID, '/memories/a.md', 'x', 'create', 'coach');
    expect(log.map((l) => l.sql.split(' ').slice(0, 3).join(' '))).toEqual([
      'begin',
      'insert into public.memory_files',
      'insert into public.memory_file_versions',
      'commit',
    ]);
    expect(log[2]?.values).toEqual([SID, '/memories/a.md', 'create', 'coach', 'x']);
    await s.rename(SID, '/memories/a.md', '/memories/b.md', 'coach');
    expect(await s.read(SID, '/memories/b.md')).toBe('x');
  });

  it('hata olursa rollback', async () => {
    const log: string[] = [];
    const client: PgClientLike = {
      query: async (sql: string) => {
        log.push(sql.split(' ')[0] ?? '');
        if (sql.startsWith('insert into public.memory_files')) throw new Error('OGR-MEM-001 hafıza dosyası sınırı');
        return { rows: [] };
      },
      release: () => undefined,
    };
    const s = new PgStore({ connect: async () => client, query: client.query });
    await expect(s.write(SID, '/memories/a.md', 'x', 'create', 'coach')).rejects.toThrow(/OGR-MEM-001/);
    expect(log).toEqual(['begin', 'insert', 'rollback']);
  });
});
