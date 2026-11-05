import { describe, expect, it } from 'vitest';
import {
  applyMemoryDelta,
  createMemoryHandlers,
  InMemoryStore,
  MEMORY_DELTA_ACTOR,
  PARENT_SUMMARY_PATH,
  type MemoryDeltaOp,
} from '../src/memory/pgMemory.js';

const SID = '11111111-1111-4111-8111-111111111111';
const PATTERNS = '/memories/patterns.md';
const LINE = '- Parantez önündeki eksiyi dağıtırken işaret kaçıyor · tyt.mat.temel.sayilar · 2× · 12 Eki, 19 Eki';

async function seeded() {
  const store = new InMemoryStore(() => new Date('2026-11-03T09:00:00Z'));
  await store.write(SID, PATTERNS, LINE, 'create', 'coach');
  return store;
}

describe('applyMemoryDelta (memory_delta → hafıza işleyicileri)', () => {
  it('str_replace + insert uygulanır; sürüm satırı memory-delta yazanıyla', async () => {
    const store = await seeded();
    const ops: MemoryDeltaOp[] = [
      { op: 'str_replace', path: PATTERNS, old_str: LINE, new_str: LINE.replace('2×', '3×') + ', 3 Kas' },
      { op: 'insert', path: PATTERNS, insert_line: 1, text: '- Kesirleri toplarken paydaları da topluyor · tyt.mat.temel.rasyonel-sayilar · 1× · 3 Kas' },
    ];
    const r = await applyMemoryDelta({ store, studentId: SID, actor: MEMORY_DELTA_ACTOR }, ops);
    expect(r).toMatchObject({ applied: 2, failed: 0 });
    const content = await store.read(SID, PATTERNS);
    expect(content?.split('\n')).toEqual([
      '- Parantez önündeki eksiyi dağıtırken işaret kaçıyor · tyt.mat.temel.sayilar · 3× · 12 Eki, 19 Eki, 3 Kas',
      '- Kesirleri toplarken paydaları da topluyor · tyt.mat.temel.rasyonel-sayilar · 1× · 3 Kas',
    ]);
    expect(store.versions.slice(1).map((v) => [v.op, v.actor])).toEqual([
      ['str_replace', 'memory-delta'],
      ['insert', 'memory-delta'],
    ]);
  });

  it('dosya yokken insert_line 0 dosyayı oluşturur; başka satırda OGR-MEM-017', async () => {
    const store = new InMemoryStore();
    const r = await applyMemoryDelta({ store, studentId: SID, actor: MEMORY_DELTA_ACTOR }, [
      { op: 'insert', path: '/memories/coach_notes.md', insert_line: 0, text: '- Kesir şeridi işe yaradı\n' },
      { op: 'insert', path: '/memories/goals.md', insert_line: 3, text: '- 30 net' },
    ]);
    expect(r.results.map((x) => [x.ok, x.code])).toEqual([
      [true, null],
      [false, 'OGR-MEM-017'],
    ]);
    expect(await store.read(SID, '/memories/coach_notes.md')).toBe('- Kesir şeridi işe yaradı');
  });

  it('bir işlem düşerse diğerleri yine uygulanır; hata kodu işlem başına döner', async () => {
    const store = await seeded();
    const r = await applyMemoryDelta({ store, studentId: SID, actor: MEMORY_DELTA_ACTOR }, [
      { op: 'str_replace', path: PATTERNS, old_str: 'dosyada olmayan satır', new_str: 'x' },
      { op: 'insert', path: '/etc/passwd', insert_line: 0, text: 'x' },
      { op: 'insert', path: PATTERNS, insert_line: 1, text: '- yeni' },
    ]);
    expect(r.results.map((x) => x.code)).toEqual(['OGR-MEM-021', 'OGR-MEM-012', null]);
    expect(r.applied).toBe(1);
  });

  it('parent_summary.md delta ile yazılamaz (OGR-MEM-007); 3 işlemden fazlası atlanır', async () => {
    const store = await seeded();
    const ops: MemoryDeltaOp[] = [
      { op: 'insert', path: PARENT_SUMMARY_PATH, insert_line: 0, text: 'sızıntı' },
      ...Array.from({ length: 3 }, (_, i) => ({ op: 'insert' as const, path: PATTERNS, insert_line: 1, text: `- ${i}` })),
    ];
    const r = await applyMemoryDelta({ store, studentId: SID, actor: MEMORY_DELTA_ACTOR }, ops);
    expect(r.results.map((x) => x.code)).toEqual(['OGR-MEM-007', null, null, 'OGR-MEM-027']);
    expect(await store.read(SID, PARENT_SUMMARY_PATH)).toBeNull();
  });

  it('hazır işleyicilerle de çalışır (salt okunur bağlam her işlemi reddeder)', async () => {
    const store = await seeded();
    const h = createMemoryHandlers({ store, studentId: SID, actor: 'coach', readOnly: true });
    const r = await applyMemoryDelta(h, [{ op: 'insert', path: PATTERNS, insert_line: 0, text: '- x' }]);
    expect(r.results[0]?.code).toBe('OGR-MEM-016');
  });

  it('boyut sınırı (8 KB) işleyicide', async () => {
    const store = await seeded();
    const r = await applyMemoryDelta({ store, studentId: SID, actor: MEMORY_DELTA_ACTOR }, [
      { op: 'insert', path: PATTERNS, insert_line: 1, text: 'ç'.repeat(4200) },
    ]);
    expect(r.results[0]?.code).toBe('OGR-MEM-002');
  });
});
