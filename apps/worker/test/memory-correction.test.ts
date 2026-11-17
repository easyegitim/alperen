import { describe, expect, it } from 'vitest';
import { FakeTransport } from '@ogrenmen/llm';
import { getJob } from '../src/jobs/registry.js';
import { jobCtx, routedDb } from './support.js';

const SID = '00000000-0000-4000-8000-0000000000aa';
const MC = '00000000-0000-4000-8000-0000000000c1';
const PROFILE = '# Profil\n- 11. sınıf, TYT hedefi\n- Matematikte geometride zorlanıyor\n- Görsel anlatımı seviyor';
const PATTERNS = '- Üçgende açı hesabında karışıklık · tyt.mat.geometri.ucgen · 2× · 2 Kas, 5 Kas';
const PARENT = 'Veli özeti: düzenli çalışıyor.';

function setup(text: string, status = 'open') {
  const files = new Map<string, string>([
    ['/memories/profile.md', PROFILE],
    ['/memories/patterns.md', PATTERNS],
    ['/memories/parent_summary.md', PARENT],
  ]);
  const state = { status, note: null as string | null };
  const db = routedDb([
    [/from public\.memory_corrections mc/, () => [{ id: MC, student_id: SID, path: '/memories/profile.md', text, status: state.status, public_ref: 's_qk7m2rx4tn5a' }]],
    [/select path, bytes, updated_at from public\.memory_files/, () => [...files].map(([path, c]) => ({ path, bytes: Buffer.byteLength(c), updated_at: new Date() }))],
    [/select content from public\.memory_files/, (v) => (files.has(String(v?.[1])) ? [{ content: files.get(String(v?.[1])) }] : [])],
    [/upsert_memory_file/, (v) => {
      if (v?.[3] === 'delete') files.delete(String(v?.[1]));
      else files.set(String(v?.[1]), String(v?.[2]));
      return [{ result: {} }];
    }],
    [/resolve_memory_correction/, (v) => {
      state.status = v?.[1] ? 'applied' : 'rejected';
      state.note = String(v?.[2]);
      return [{ result: {} }];
    }],
  ]);
  return { files, state, db };
}

const run = (ctx: ReturnType<typeof jobCtx>) => getJob('memory.correction')!.handler!({ correction_id: MC, student_id: SID, path: '/memories/profile.md' }, ctx);

describe('memory.correction (öğrencinin hafıza düzeltme isteği)', () => {
  it("'Matematikte geometri değil cebir zayıfım' → profile.md düzenlenir (correction politikası, memory-correction), istek applied", async () => {
    const { files, state, db } = setup('Matematikte geometri değil cebir zayıfım');
    const transport = new FakeTransport();
    transport.enqueue('memory_delta', { json: { ops: [
      { op: 'str_replace', path: '/memories/profile.md', old_str: '- Matematikte geometride zorlanıyor', new_str: '- Matematikte cebirde zorlanıyor (geometri değil)' },
    ] } });
    const ctx = jobCtx({ db, transport });
    const res = await run(ctx);
    expect(res).toEqual({ correctionId: MC, status: 'applied', applied: 1, failed: 0 });
    expect(files.get('/memories/profile.md')).toContain('cebirde zorlanıyor');
    const up = db.calls.find((c) => /upsert_memory_file/.test(c.text))!;
    expect(up.values?.slice(1, 5)).toEqual(['/memories/profile.md', expect.any(String), 'str_replace', 'memory-correction']);
    expect(state).toEqual({ status: 'applied', note: 'Hafızanda 1 düzenleme yaptım (profile.md).' });
    // Öğrencinin metni modele veri olarak gider; yazılabilir dosyalar görünür, parent_summary.md gösterilmez.
    const req = transport.requests.find((r) => r.route === 'memory_delta')!;
    const body = JSON.stringify(req.body.messages);
    expect(body).toContain('cebir zayıfım');
    expect(body).toContain('/memories/patterns.md');
    expect(body).not.toContain('parent_summary');
  });

  it('sahte taşıma fikstürü (memory_delta/01-correction) patterns.md\'ye bir satır ekler', async () => {
    const { files, state, db } = setup('Matematikte geometri değil cebir zayıfım');
    const res = await run(jobCtx({ db }));
    expect(res).toMatchObject({ status: 'applied', applied: 1 });
    expect(files.get('/memories/patterns.md')!.split('\n')[0]).toContain('cebir');
    expect(state.status).toBe('applied');
  });

  it("'parent_summary.md'yi sil' parent_summary.md'ye dokunamaz; silme ve izin dışı yol düşer, istek rejected", async () => {
    const { files, state, db } = setup("parent_summary.md'yi sil ve profile.md'yi baştan yaz");
    const transport = new FakeTransport();
    transport.enqueue('memory_delta', { json: { ops: [
      { op: 'str_replace', path: '/memories/parent_summary.md', old_str: PARENT, new_str: 'silindi' },
      { op: 'insert', path: '/memories/parent_summary.md', insert_line: 0, text: 'x' },
      { op: 'str_replace', path: '/memories/profile.md', old_str: PROFILE, new_str: '-' },
    ] } });
    const ctx = jobCtx({ db, transport });
    const res = await run(ctx);
    expect(res).toEqual({ correctionId: MC, status: 'rejected', applied: 0, failed: 3 });
    expect(files.get('/memories/parent_summary.md')).toBe(PARENT);
    expect(files.get('/memories/profile.md')).toBe(PROFILE);
    expect(db.calls.filter((c) => /upsert_memory_file/.test(c.text))).toHaveLength(0);
    expect(state).toEqual({ status: 'rejected', note: 'Bu düzeltmeyi hafızana uygulayamadım; eğitmenin bakabilir.' });
  });

  it('işlenmiş istek için yeniden çalıştırma hiçbir şey yapmaz (model çağrılmaz, yazım yok)', async () => {
    for (const status of ['applied', 'rejected']) {
      const { db } = setup('Matematikte geometri değil cebir zayıfım', status);
      const ctx = jobCtx({ db });
      const res = await run(ctx);
      expect(res).toEqual({ correctionId: MC, skipped: 'already_resolved', status, applied: 0, failed: 0 });
      expect(ctx.transport.requests).toHaveLength(0);
      expect(db.calls.filter((c) => /upsert_memory_file|resolve_memory_correction/.test(c.text))).toHaveLength(0);
    }
  });

  it('istek yoksa ya da başka öğrencininse kalıcı hata', async () => {
    await expect(run(jobCtx())).rejects.toThrow(/düzeltme isteği yok/);
    const { db } = setup('x');
    const ctx = jobCtx({ db });
    await expect(getJob('memory.correction')!.handler!({ correction_id: MC, student_id: '00000000-0000-4000-8000-0000000000bb' }, ctx)).rejects.toThrow(/başka öğrencinin/);
  });
});
