import { describe, expect, it } from 'vitest';
import {
  assertMemoryPath,
  createMemoryHandlers,
  InMemoryStore,
  MEMORY_MAX_BYTES,
  MemoryError,
  PARENT_SUMMARY_MAX_BYTES,
  PARENT_SUMMARY_PATH,
  PgStore,
  RpcMemoryStore,
  runMemoryCommand,
  UPSERT_MEMORY_FILE_SQL,
  type PgQueryLike,
  type SupabaseLike,
} from '../src/memory/pgMemory.js';

const SID = '11111111-1111-4111-8111-111111111111';

function mk(opts: { readOnly?: boolean; actor?: string; allowParentSummary?: boolean } = {}) {
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
    '/memories/a_b-c.d.txt',
    '/memories/courses/tyt/k1.md',
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
    `/memories/${'a'.repeat(250)}.md`,
    '/memories/x.json',
    '/memories/a_b-c.d',
    '/memories/a/b/c/d.md',
    '/memories/.hidden.md',
    '/memories/a..b.md',
    '/memories/courses',
  ])('reddedilir: %s', (p) => expect(() => assertMemoryPath(p)).toThrow(MemoryError));

  it('DB izin listesiyle aynı: .json ve 3 düzey derinlik OGR-MEM-012', () => {
    for (const p of ['/memories/x.json', '/memories/a/b/c/d.md']) {
      try {
        assertMemoryPath(p);
        expect.unreachable(p);
      } catch (e) {
        expect((e as MemoryError).code, p).toBe('OGR-MEM-012');
      }
    }
  });

  it('view kökü kabul eder', () => expect(assertMemoryPath('/memories', { allowRoot: true })).toBe('/memories'));
  it('dizin yolu yalnız allowDir ile (en çok 2 düzey)', () => {
    expect(assertMemoryPath('/memories/courses', { allowDir: true })).toBe('/memories/courses');
    expect(assertMemoryPath('/memories/courses/tyt/', { allowDir: true })).toBe('/memories/courses/tyt');
    expect(() => assertMemoryPath('/memories/a/b/c', { allowDir: true })).toThrow(MemoryError);
  });
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
    expect(await code(Promise.resolve(h.create({ command: 'create', path: '/memories/x.json', file_text: '{}' })))).toBe('OGR-MEM-012');
    expect(await code(Promise.resolve(h.create({ command: 'create', path: '/memories/a/b/c/d.md', file_text: 'x' })))).toBe('OGR-MEM-012');
    expect(await code(Promise.resolve(h.create({ command: 'create', path: '/memories/courses', file_text: 'x' })))).toBe('OGR-MEM-012');
  });

  it('coach parent_summary.md yazamaz (create/str_replace/insert/delete/rename)', async () => {
    const night = mk({ actor: 'memory-compact' });
    await night.h.create({ command: 'create', path: PARENT_SUMMARY_PATH, file_text: 'Bu hafta 4 saat çalıştı.' });
    const h = createMemoryHandlers({ store: night.store, studentId: SID, actor: 'coach' });
    await h.create({ command: 'create', path: '/memories/notes.md', file_text: 'koç notu' });
    const cmds = [
      h.create({ command: 'create', path: PARENT_SUMMARY_PATH, file_text: 'sohbetten sızıntı' }),
      h.str_replace({ command: 'str_replace', path: PARENT_SUMMARY_PATH, old_str: '4 saat', new_str: 'sızıntı' }),
      h.insert({ command: 'insert', path: PARENT_SUMMARY_PATH, insert_line: 0, insert_text: 'sızıntı' }),
      h.delete({ command: 'delete', path: PARENT_SUMMARY_PATH }),
      h.rename({ command: 'rename', old_path: '/memories/notes.md', new_path: PARENT_SUMMARY_PATH }),
      h.rename({ command: 'rename', old_path: PARENT_SUMMARY_PATH, new_path: '/memories/x.md' }),
    ];
    for (const c of cmds) expect(await code(Promise.resolve(c))).toBe('OGR-MEM-007');
    expect(await night.store.read(SID, PARENT_SUMMARY_PATH)).toBe('Bu hafta 4 saat çalıştı.');
    // okuma serbest
    expect(await h.view({ command: 'view', path: PARENT_SUMMARY_PATH })).toContain('4 saat');
    // öğrenci/eğitmen bağlamı da yazamaz
    const st = createMemoryHandlers({ store: night.store, studentId: SID, actor: `student:${SID}` });
    expect(await code(Promise.resolve(st.create({ command: 'create', path: PARENT_SUMMARY_PATH, file_text: 'x' })))).toBe('OGR-MEM-007');
  });

  it('parent_summary.md ≤ 1.5 KB (gece işi için de)', async () => {
    const { h } = mk({ actor: 'memory-compact' });
    expect(await code(Promise.resolve(h.create({ command: 'create', path: PARENT_SUMMARY_PATH, file_text: 'x'.repeat(PARENT_SUMMARY_MAX_BYTES) })))).toBeNull();
    expect(await code(Promise.resolve(h.insert({ command: 'insert', path: PARENT_SUMMARY_PATH, insert_line: 1, insert_text: 'y' })))).toBe('OGR-MEM-007');
    // 'ş' iki bayt: 769 karakter = 1538 bayt
    expect(await code(Promise.resolve(h.create({ command: 'create', path: PARENT_SUMMARY_PATH, file_text: 'ş'.repeat(769) })))).toBe('OGR-MEM-007');
    // büyük dosyayı parent_summary.md'ye taşımak da reddedilir
    await h.create({ command: 'create', path: '/memories/big.md', file_text: 'z'.repeat(4000) });
    await h.delete({ command: 'delete', path: PARENT_SUMMARY_PATH });
    expect(await code(Promise.resolve(h.rename({ command: 'rename', old_path: '/memories/big.md', new_path: PARENT_SUMMARY_PATH })))).toBe('OGR-MEM-007');
  });

  it('allowParentSummary açıkça verilebilir', async () => {
    const { h } = mk({ actor: 'instructor:x', allowParentSummary: true });
    expect(await code(Promise.resolve(h.create({ command: 'create', path: PARENT_SUMMARY_PATH, file_text: 'özet' })))).toBeNull();
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

describe('PgStore (upsert_memory_file RPC)', () => {
  function fakeDb(fail?: string) {
    const log: { sql: string; values: unknown[] | undefined }[] = [];
    const rows = new Map<string, string>();
    const db: PgQueryLike = {
      query: async (sql: string, values?: unknown[]) => {
        log.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
        if (sql.startsWith('select content')) {
          const c = rows.get(String(values?.[1]));
          return { rows: c === undefined ? [] : [{ content: c }] };
        }
        if (sql === UPSERT_MEMORY_FILE_SQL) {
          if (fail) throw new Error(fail);
          const [, path, content, op, , newPath] = values ?? [];
          if (op === 'delete') rows.delete(String(path));
          else if (op === 'rename') {
            const c = rows.get(String(path));
            rows.delete(String(path));
            if (c !== undefined) rows.set(String(newPath), c);
          } else rows.set(String(path), String(content));
          return { rows: [{ result: { path, op } }] };
        }
        return { rows: [] };
      },
    };
    return { db, log };
  }

  it('her yazım tek RPC çağrısı (dosya + sürüm DB tarafında); doğrudan insert yok', async () => {
    const { db, log } = fakeDb();
    const s = new PgStore(db);
    await s.write(SID, '/memories/a.md', 'x', 'create', 'coach');
    await s.rename(SID, '/memories/a.md', '/memories/b.md', 'coach');
    expect(await s.read(SID, '/memories/b.md')).toBe('x');
    await s.remove(SID, '/memories/b.md', 'coach');
    const rpc = log.filter((l) => l.sql.startsWith('select public.upsert_memory_file'));
    expect(rpc.map((l) => l.values)).toEqual([
      [SID, '/memories/a.md', 'x', 'create', 'coach', null],
      [SID, '/memories/a.md', null, 'rename', 'coach', '/memories/b.md'],
      [SID, '/memories/b.md', null, 'delete', 'coach', null],
    ]);
    expect(log.some((l) => /^(insert|update|delete) /.test(l.sql))).toBe(false);
  });

  it('DB hatası MemoryError koduna çevrilir', async () => {
    const { db } = fakeDb('OGR-MEM-003 yol izin listesinde değil: /memories/x.json');
    const s = new PgStore(db);
    const e = await s.write(SID, '/memories/x.md', 'x', 'create', 'coach').catch((err: unknown) => err);
    expect(e).toBeInstanceOf(MemoryError);
    expect((e as MemoryError).code).toBe('OGR-MEM-003');
  });

  it('service_role yolu: parent_summary.md yalnız memory-compact, ≤ 1.5 KB (RPC atlanmadan önce)', async () => {
    const { db, log } = fakeDb();
    const s = new PgStore(db);
    expect(await code(s.write(SID, PARENT_SUMMARY_PATH, 'x', 'create', 'coach'))).toBe('OGR-MEM-007');
    expect(await code(s.rename(SID, '/memories/a.md', PARENT_SUMMARY_PATH, 'coach'))).toBe('OGR-MEM-007');
    expect(await code(s.write(SID, PARENT_SUMMARY_PATH, 'x'.repeat(PARENT_SUMMARY_MAX_BYTES + 1), 'compact', 'memory-compact'))).toBe('OGR-MEM-007');
    expect(log).toHaveLength(0);
    expect(await code(s.write(SID, PARENT_SUMMARY_PATH, 'özet', 'compact', 'memory-compact'))).toBeNull();
  });
});

describe('RpcMemoryStore (apps/web, kullanıcı JWT)', () => {
  function fakeSupabase(rpcError?: string) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const selects: { table: string; columns: string; filters: [string, unknown][]; order: string | null }[] = [];
    const files = [{ path: '/memories/profile.md', bytes: 3, updated_at: '2026-11-02T09:00:00Z', content: 'abc' }];
    const client: SupabaseLike = {
      rpc: (fn, args) => {
        calls.push({ fn, args });
        return Promise.resolve(rpcError ? { data: null, error: { message: rpcError } } : { data: { ok: true }, error: null });
      },
      from: (table) => ({
        select: (columns) => {
          const q = { table, columns, filters: [] as [string, unknown][], order: null as string | null };
          selects.push(q);
          const run = () => {
            const rows = files
              .filter((f) => q.filters.every(([c, v]) => (c === 'student_id' ? v === SID : (f as Record<string, unknown>)[c] === v)))
              .map((f) => Object.fromEntries(columns.split(',').map((c) => c.trim()).map((c) => [c, (f as Record<string, unknown>)[c]])));
            return { data: rows, error: null };
          };
          const b = {
            eq: (c: string, v: unknown) => {
              q.filters.push([c, v]);
              return b;
            },
            order: (c: string) => {
              q.order = c;
              return b;
            },
            then: (ok: (x: ReturnType<typeof run>) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko),
          };
          return b as never;
        },
      }),
    };
    return { client, calls, selects };
  }

  it('okuma RLS li select; yazım upsert_memory_file RPC', async () => {
    const { client, calls, selects } = fakeSupabase();
    const s = new RpcMemoryStore(client);
    expect(await s.list(SID)).toEqual([{ path: '/memories/profile.md', bytes: 3, updatedAt: '2026-11-02T09:00:00Z' }]);
    expect(await s.read(SID, '/memories/profile.md')).toBe('abc');
    expect(await s.read(SID, '/memories/yok.md')).toBeNull();
    expect(selects[0]).toMatchObject({ table: 'memory_files', order: 'path' });
    await s.write(SID, '/memories/profile.md', 'yeni', 'str_replace', `student:${SID}`);
    await s.rename(SID, '/memories/profile.md', '/memories/p.md', 'coach');
    await s.remove(SID, '/memories/p.md', 'coach');
    expect(calls).toEqual([
      { fn: 'upsert_memory_file', args: { p_student: SID, p_path: '/memories/profile.md', p_content: 'yeni', p_op: 'str_replace', p_actor: `student:${SID}`, p_new_path: null } },
      { fn: 'upsert_memory_file', args: { p_student: SID, p_path: '/memories/profile.md', p_content: null, p_op: 'rename', p_actor: 'coach', p_new_path: '/memories/p.md' } },
      { fn: 'upsert_memory_file', args: { p_student: SID, p_path: '/memories/p.md', p_content: null, p_op: 'delete', p_actor: 'coach', p_new_path: null } },
    ]);
  });

  it('RPC hatası (OGR-MEM-007) işleyiciden modele is_error olarak gider', async () => {
    const { client } = fakeSupabase('OGR-MEM-007 parent_summary.md yalnız gece işi tarafından yazılır');
    const h = createMemoryHandlers({ store: new RpcMemoryStore(client), studentId: SID, actor: 'memory-compact' });
    expect(await code(Promise.resolve(h.create({ command: 'create', path: PARENT_SUMMARY_PATH, file_text: 'x' })))).toBe('OGR-MEM-007');
  });
});
