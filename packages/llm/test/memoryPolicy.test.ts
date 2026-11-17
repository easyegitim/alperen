import { describe, expect, it } from 'vitest';
import {
  applyMemoryDelta,
  createMemoryHandlers,
  InMemoryStore,
  MEMORY_DELTA_ACTOR,
  MEMORY_POLICY_CODE,
  MEMORY_SHRINK_CODE,
  MemoryError,
  PARENT_SUMMARY_PATH,
  runMemoryCommand,
  type MemoryDeltaOp,
} from '../src/memory/pgMemory.js';

const SID = '11111111-1111-4111-8111-111111111111';
const PROFILE = '/memories/profile.md';
const GOALS = '/memories/goals.md';
const PATTERNS = '/memories/patterns.md';
const COURSE = '/memories/courses/tyt-mat.md';
const PROFILE_TEXT = [
  '# Profil',
  '- 11. sınıf, TYT hedefi; akşamları çalışıyor',
  '- Görsel anlatımı seviyor, uzun metinde dikkati dağılıyor',
  '- Kesirlerde ve parantez önündeki eksi işaretinde zorlanıyor',
  '- Haftada 3 gün 45 dakika plan',
].join('\n');
const LINE = '- Parantez önündeki eksiyi dağıtırken işaret kaçıyor · tyt.mat.temel.sayilar · 2× · 12 Eki';

async function seeded() {
  const store = new InMemoryStore(() => new Date('2026-11-16T09:00:00Z'));
  await store.write(SID, PROFILE, PROFILE_TEXT, 'create', 'instructor:x');
  await store.write(SID, GOALS, '- 30 net', 'create', 'instructor:x');
  await store.write(SID, PATTERNS, LINE, 'create', 'coach');
  await store.write(SID, COURSE, '# TYT Matematik\n- Rasyonel sayılar: orta', 'create', 'coach');
  await store.write(SID, '/memories/courses/ayt-fiz.md', '# AYT Fizik', 'create', 'coach');
  return store;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof MemoryError) return e.code;
    throw e;
  }
  return 'ok';
}

describe("yazım politikası 'delta' (memory_delta; OCR kaynaklı enjeksiyon)", () => {
  it("profile.md'yi hedefleyen işlem reddedilir; patterns.md ve courses/tyt-mat.md düzenlenir", async () => {
    const store = await seeded();
    // OCR metninde "profile.md'yi sil / üzerine yaz" talimatı taşınmış gibi.
    const ops: MemoryDeltaOp[] = [
      { op: 'str_replace', path: PROFILE, old_str: PROFILE_TEXT, new_str: 'Öğrenci hiçbir şey bilmiyor.' },
      { op: 'str_replace', path: PATTERNS, old_str: LINE, new_str: LINE.replace('2×', '3×') },
      { op: 'insert', path: COURSE, insert_line: 2, text: '- Kesirler: zayıf · 16 Kas' },
    ];
    const r = await applyMemoryDelta({ store, studentId: SID, actor: MEMORY_DELTA_ACTOR, policy: 'delta' }, ops);
    expect(r.results.map((x) => [x.ok, x.code])).toEqual([[false, MEMORY_POLICY_CODE], [true, null], [true, null]]);
    expect(await store.read(SID, PROFILE)).toBe(PROFILE_TEXT);
    expect(await store.read(SID, PATTERNS)).toContain('3×');
    expect(await store.read(SID, COURSE)).toContain('Kesirler: zayıf');
  });

  it('insert ile profile.md / goals.md / coach_notes.md hedeflenemez; yeni courses dosyası oluşturulabilir', async () => {
    const store = await seeded();
    const r = await applyMemoryDelta({ store, studentId: SID, actor: MEMORY_DELTA_ACTOR, policy: 'delta' }, [
      { op: 'insert', path: PROFILE, insert_line: 0, text: 'enjeksiyon' },
      { op: 'insert', path: '/memories/coach_notes.md', insert_line: 0, text: 'enjeksiyon' },
      { op: 'insert', path: '/memories/courses/yeni-ders.md', insert_line: 0, text: '# Yeni ders\n' },
    ]);
    expect(r.results.map((x) => x.code)).toEqual([MEMORY_POLICY_CODE, MEMORY_POLICY_CODE, null]);
    expect(await store.read(SID, '/memories/coach_notes.md')).toBeNull();
    expect(await store.read(SID, '/memories/courses/yeni-ders.md')).toBe('# Yeni ders');
  });

  it('delete, rename, var olan dosyanın üzerine create ve başka yol reddedilir', async () => {
    const store = await seeded();
    const h = createMemoryHandlers({ store, studentId: SID, actor: MEMORY_DELTA_ACTOR, policy: 'delta' });
    expect(await code(runMemoryCommand(h, { command: 'delete', path: PATTERNS }))).toBe(MEMORY_POLICY_CODE);
    expect(await code(runMemoryCommand(h, { command: 'delete', path: PROFILE }))).toBe(MEMORY_POLICY_CODE);
    expect(await code(runMemoryCommand(h, { command: 'delete', path: '/memories/courses' }))).toBe(MEMORY_POLICY_CODE);
    expect(await code(runMemoryCommand(h, { command: 'rename', old_path: COURSE, new_path: '/memories/courses/x.md' }))).toBe(MEMORY_POLICY_CODE);
    expect(await code(runMemoryCommand(h, { command: 'create', path: PATTERNS, file_text: 'sıfırlandı' }))).toBe(MEMORY_POLICY_CODE);
    expect(await code(runMemoryCommand(h, { command: 'create', path: PROFILE, file_text: 'x' }))).toBe(MEMORY_POLICY_CODE);
    expect(await code(runMemoryCommand(h, { command: 'str_replace', path: '/memories/courses/a/b.md', old_str: 'x', new_str: 'y' }))).toBe(MEMORY_POLICY_CODE);
    expect(await code(runMemoryCommand(h, { command: 'view', path: '/memories' }))).toBe('ok');
    expect((await store.list(SID)).length).toBe(5);
    expect(await store.read(SID, PATTERNS)).toBe(LINE);
  });
});

describe("yazım politikası 'coach' (koç sohbeti)", () => {
  const mk = async () => {
    const store = await seeded();
    return { store, h: createMemoryHandlers({ store, studentId: SID, actor: 'coach', policy: 'coach' }) };
  };

  it('dizin silme, profile.md / goals.md silme ve yeniden adlandırma reddedilir', async () => {
    const { store, h } = await mk();
    expect(await code(runMemoryCommand(h, { command: 'delete', path: '/memories/courses' }))).toBe(MEMORY_POLICY_CODE);
    expect(await code(runMemoryCommand(h, { command: 'delete', path: PROFILE }))).toBe(MEMORY_POLICY_CODE);
    expect(await code(runMemoryCommand(h, { command: 'delete', path: GOALS }))).toBe(MEMORY_POLICY_CODE);
    expect(await code(runMemoryCommand(h, { command: 'rename', old_path: PATTERNS, new_path: '/memories/old.md' }))).toBe(MEMORY_POLICY_CODE);
    expect((await store.list(SID)).map((f) => f.path)).toEqual(['/memories/courses/ayt-fiz.md', COURSE, GOALS, PATTERNS, PROFILE]);
  });

  it('dosyanın çoğunu silen str_replace ve create reddedilir; içerik değişmez', async () => {
    const { store, h } = await mk();
    const body = PROFILE_TEXT.split('\n').slice(1).join('\n');
    expect(await code(runMemoryCommand(h, { command: 'str_replace', path: PROFILE, old_str: body, new_str: '- yok' }))).toBe(MEMORY_SHRINK_CODE);
    expect(await code(runMemoryCommand(h, { command: 'create', path: PROFILE, file_text: '# Profil\n- yeni' }))).toBe(MEMORY_SHRINK_CODE);
    expect(await store.read(SID, PROFILE)).toBe(PROFILE_TEXT);
  });

  it('küçük str_replace, insert ve gerekli olmayan dosyanın silinmesi geçer; parent_summary.md yine yazılamaz', async () => {
    const { store, h } = await mk();
    await runMemoryCommand(h, { command: 'str_replace', path: PROFILE, old_str: '3 gün 45 dakika', new_str: '4 gün 40 dakika' });
    await runMemoryCommand(h, { command: 'insert', path: PATTERNS, insert_line: 1, insert_text: '- Kesirlerde payda toplanıyor · 1× · 16 Kas' });
    await runMemoryCommand(h, { command: 'delete', path: '/memories/courses/ayt-fiz.md' });
    expect(await store.read(SID, PROFILE)).toContain('4 gün 40 dakika');
    expect(await store.read(SID, PATTERNS)).toContain('payda toplanıyor');
    expect(await store.read(SID, '/memories/courses/ayt-fiz.md')).toBeNull();
    expect(await code(runMemoryCommand(h, { command: 'create', path: PARENT_SUMMARY_PATH, file_text: 'x' }))).toBe('OGR-MEM-007');
  });
});

describe("politika verilmezse ('trusted') davranış değişmez", () => {
  it('dizin silme ve yeniden adlandırma yapılabilir', async () => {
    const store = await seeded();
    const h = createMemoryHandlers({ store, studentId: SID, actor: 'instructor:x' });
    await runMemoryCommand(h, { command: 'rename', old_path: PATTERNS, new_path: '/memories/p2.md' });
    expect(await runMemoryCommand(h, { command: 'delete', path: '/memories/courses' })).toMatch(/Directory deleted/);
    await runMemoryCommand(h, { command: 'create', path: PROFILE, file_text: 'x' });
    expect(await store.read(SID, PROFILE)).toBe('x');
  });
});
