/**
 * practice.generate / practice.prewarm birim testleri (sahte veritabanı yönlendiricisi + sahte LLM taşıması):
 * şablon planı, LLM çıktısı eşlemesi (yaprak, şekil, tutarsız madde), şablon yolu seti doldurur (LLM çağrılmaz),
 * şablon yetmezse fake LLM (8 deterministik soru) yolu, kalıcı hatada set generation_failed ile kapanır, ön ısıtma
 * alıştırması açılamayan taslakta üretmez. Gerçek şablon doldurucu (python3 -I) Python + SymPy varsa koşar.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExamGeneration } from '@ogrenmen/contracts';
import { getJob } from '../src/jobs/registry.js';
import { practiceHooks } from '../src/jobs/practice-generate.js';
import {
  distribute,
  llmContentHash,
  mapGenerated,
  pythonKeyVerifier,
  pythonTemplateRunner,
  templatePlan,
  verifyKeys,
  type BankItem,
  type KeyVerifier,
  type LeafStatus,
  type TemplateRunner,
  type TemplateVariant,
} from '../src/practice/bank.js';
import { jobCtx, routedDb, type Route } from './support.js';

const SET = '11111111-1111-4111-8111-111111111111';
const ENR = '22222222-2222-4222-8222-222222222222';
const CUR = '33333333-3333-4333-8333-333333333333';

function leaf(skill_id: string, templates: string[] = [], available = 0): LeafStatus {
  return { skill_id, name: skill_id, description: null, available, templates };
}

function variant(i: number, template_id = 'islem-onceligi'): TemplateVariant {
  return {
    template_id,
    skill_ids: ['tyt.mat.temel.sayilar'],
    kind: 'mcq',
    stem: `\`${i} + 2 · 3\` işleminin sonucu kaçtır?`,
    stem_values: {},
    options: [
      { key: 'A', text: String(i + 6), misconception_tag: null },
      { key: 'B', text: String((i + 2) * 3), misconception_tag: 'sayilar.islem-onceligi-soldan' },
      { key: 'C', text: '0', misconception_tag: null },
      { key: 'D', text: '1', misconception_tag: null },
    ],
    difficulty: 0.5,
    template_params: { a: i },
    content_hash: `tpl-${template_id}-${i}`,
    key: { correct_option: 'A', numeric_value: null, canonical_expr: `${i} + 2*3`, solution: 'Önce çarpma.', sympy_status: 'verified', sympy_report: null },
    figure: null,
  };
}

/** Sahte veritabanı: set satırı, banka durumu ve register_practice_questions çağrılarını kaydeder. */
function world(opts: { leaves: LeafStatus[]; status?: string; practicable?: boolean; fillThreshold?: number }) {
  const registered: { items: BankItem[]; set: string | null }[] = [];
  let bank = 0;
  let setStatus = opts.status ?? 'needs_generation';
  const failed: string[] = [];
  const routes: Route[] = [
    [/from public\.practice_sets ps\s+join public\.enrollments/, () => [{ id: SET, status: setStatus, enrollment_id: ENR, curriculum_id: CUR, skill_ids: opts.leaves.map((l) => l.skill_id), target_count: 8, items: 0, course_title: 'TYT Matematik', student_ref: 's_test0001' }]],
    [/practice_bank_status/, () => [{ s: { enrollment_id: ENR, curriculum_id: CUR, curriculum_status: 'active', practicable: opts.practicable ?? true, leaves: opts.leaves } }]],
    [/select q\.content_hash from public\.questions/, () => []],
    [/register_practice_questions/, (v) => {
      const items = JSON.parse(String(v![1])) as BankItem[];
      const set = (v![2] as string | null) ?? null;
      registered.push({ items, set });
      bank += items.length;
      let status: string | null = null;
      let filled = 0;
      if (set) {
        if (setStatus === 'needs_generation' && bank >= (opts.fillThreshold ?? 1)) {
          filled = Math.min(8, bank);
          setStatus = 'in_progress';
        }
        status = setStatus;
      }
      return [{ r: { inserted: items.length, reused: 0, skipped: 0, question_ids: [], set_id: set, filled, status } }];
    }],
    [/fail_practice_generation/, (v) => {
      failed.push(String(v![0]));
      setStatus = 'abandoned';
      return [{ s: 'abandoned' }];
    }],
    [/check_spend/, () => [{ paid_allowed: true, state: 'ok' }]],
    [/from public\.practice_sets ps where ps\.enrollment_id/, () => []],
  ];
  return { db: routedDb(routes), registered, failed, status: () => setStatus };
}

const fakeRunner = (n: number): TemplateRunner => async (req) => ({
  variants: req.templates.flatMap((t) => Array.from({ length: Math.min(t.count, n) }, (_, i) => variant(i + 1, t.id))),
  errors: [],
});

/** Python'suz doğrulayıcı: her maddeyi verified sayar. */
const allVerified: KeyVerifier = async (items) => items.map((i) => ({ id: i.id, status: 'verified' as const, detail: 'test' }));

afterEach(() => {
  delete practiceHooks.templateRunner;
  delete practiceHooks.keyVerifier;
});

describe('bank yardımcıları', () => {
  it('distribute: sayıyı yapraklara sırayla dağıtır', () => {
    expect([...distribute(8, ['a', 'b'])]).toEqual([['a', 4], ['b', 4]]);
    expect([...distribute(5, ['a', 'b'])]).toEqual([['a', 3], ['b', 2]]);
  });

  it('templatePlan: ihtiyaç şablonlara bölünür (+2 yedek), şablonsuz yaprak atlanır', () => {
    const plan = templatePlan(new Map([['a', 4], ['b', 4]]), [leaf('a', ['t1', 't2']), leaf('b')]);
    expect(plan).toEqual([{ id: 't1', count: 4, skill: 'a' }, { id: 't2', count: 4, skill: 'a' }]);
  });

  it('mapGenerated: yaprak eşler, şekilli/tutarsız maddeyi atar, anahtar inferred işaretlenir', () => {
    const base = { section: 'x', figure_svg: null, style_id: null, difficulty: 'easy' as const };
    const data: ExamGeneration = {
      title: 't',
      items: [
        { ...base, no: 1, kind: 'mcq', stem: 'Birinci soru kökü burada', options: ['1', '2', '3', '4'].map((t, i) => ({ key: 'ABCD'[i] as 'A', text: t })), skill_ids: ['b'] },
        { ...base, no: 2, kind: 'numeric', stem: 'İkinci soru kökü burada', options: [], skill_ids: ['yok.boyle'] },
        { ...base, no: 3, kind: 'mcq', stem: 'Şekilli soru kökü burada', options: ['1', '2', '3', '4'].map((t, i) => ({ key: 'ABCD'[i] as 'A', text: t })), skill_ids: ['a'], figure_svg: '<svg/>' },
        { ...base, no: 4, kind: 'mcq', stem: 'Tekrarlı şıklı soru kökü', options: ['1', '1', '3', '4'].map((t, i) => ({ key: 'ABCD'[i] as 'A', text: t })), skill_ids: ['a'] },
      ],
      keys: [
        { question_no: 1, correct_option: 'B', numeric_value: null, canonical_expr: '2', solution: 'Çözüm adımları burada.' },
        { question_no: 2, correct_option: null, numeric_value: 6, canonical_expr: '6', solution: 'Çözüm adımları burada.' },
        { question_no: 3, correct_option: 'A', numeric_value: null, canonical_expr: null, solution: 'Çözüm adımları burada.' },
        { question_no: 4, correct_option: 'A', numeric_value: null, canonical_expr: null, solution: 'Çözüm adımları burada.' },
      ],
    };
    const opts = { curriculumId: CUR, need: new Map([['a', 2], ['b', 1]]), model: 'claude-opus-5-5', costUsd: 0.04, promptVersion: 'v', jobRef: 'j' };
    const { items, dropped } = mapGenerated(data, opts);
    // istenmeyen yapraklı madde (yok.boyle) başka yaprağa atanmaz: atılır
    expect(dropped).toBe(3);
    expect(items.map((i) => [i.kind, i.skill_ids])).toEqual([['mcq', ['b']]]);
    expect(items[0]!.key).toMatchObject({ correct_option: 'B', numeric_value: null, sympy_status: 'not_applicable', sympy_report: { status: 'inferred' } });
    expect(items[0]!.verification).toMatchObject({ sympy: 'inferred', origin: 'llm' });
    expect(items[0]!.content_hash).toBe(llmContentHash(CUR, ['b'], data.items[0]!.stem, data.items[0]!.options));
    expect(llmContentHash(CUR, ['a'], 'x', [])).not.toBe(llmContentHash(CUR, ['b'], 'x', []));
    // yalnız sahte taşımada (sabit fikstür kodu) istenen yaprağa eşlenir
    const fake = mapGenerated(data, { ...opts, remapForeignSkills: true });
    expect(fake.dropped).toBe(2);
    expect(fake.items.map((i) => [i.kind, i.skill_ids])).toEqual([['mcq', ['b']], ['numeric', ['a']]]);
    expect(fake.items[1]!.key).toMatchObject({ numeric_value: '6', correct_option: null });
  });

  it('verifyKeys: çelişen ve çok şıklı madde atılır, tutan verified, denetlenemeyen inferred; doğrulayıcı düşerse hepsi inferred', async () => {
    const mk = (content_hash: string): BankItem => ({
      source: 'llm', kind: 'numeric', stem: 's', options: null, skill_ids: ['a'], content_hash,
      verification: { sympy: 'inferred', origin: 'llm' }, figure: null,
      key: { correct_option: null, numeric_value: '1', canonical_expr: '1', solution: 'x', sympy_status: 'not_applicable', sympy_report: { status: 'inferred' } },
    });
    const items = ['ok', 'bad', 'amb', 'unk'].map(mk);
    const scripted: KeyVerifier = async (xs) => xs.map((x, i) => ({ id: x.id, status: (['verified', 'mismatch', 'ambiguous', 'inferred'] as const)[i]!, detail: `d${i}` }));
    const r = await verifyKeys(items, scripted);
    expect(r.items.map((i) => i.content_hash)).toEqual(['ok', 'unk']);
    expect(r.summary).toMatchObject({ verified: 1, inferred: 1, dropped: 2, error: null });
    expect(r.items[0]!).toMatchObject({ verification: { sympy: 'verified' }, key: { sympy_status: 'verified', sympy_report: { status: 'verified' } } });
    expect(r.items[1]!).toMatchObject({ verification: { sympy: 'inferred' }, key: { sympy_status: 'not_applicable', sympy_report: { status: 'inferred' } } });
    const broken = await verifyKeys(items, async () => {
      throw new Error('python yok');
    });
    expect(broken.items).toHaveLength(4);
    expect(broken.summary).toMatchObject({ inferred: 4, dropped: 0, error: 'python yok' });
    expect(broken.items.every((i) => i.verification.sympy === 'inferred')).toBe(true);
  });
});

describe('practice.generate', () => {
  it('şablon yolu: set şablonla dolar, LLM çağrılmaz', async () => {
    const w = world({ leaves: [leaf('tyt.mat.temel.sayilar', ['islem-onceligi'])] });
    practiceHooks.templateRunner = fakeRunner(20);
    const ctx = jobCtx({ db: w.db });
    const res = await getJob('practice.generate')!.handler!({ set_id: SET, enrollment_id: ENR, curriculum_id: CUR, skill_ids: ['tyt.mat.temel.sayilar'], count: 8, template_ids: ['islem-onceligi'] }, ctx);
    expect(res).toMatchObject({ set_id: SET, status: 'in_progress', template_items: 8 });
    expect(w.registered).toHaveLength(1);
    expect(w.registered[0]!.set).toBe(SET);
    expect(w.registered[0]!.items.every((i) => i.source === 'template' && i.key.sympy_status === 'verified' && i.skill_ids[0] === 'tyt.mat.temel.sayilar')).toBe(true);
    expect(ctx.transport.requests).toHaveLength(0);
  });

  it('şablon yoksa fake LLM yolu: question_generation 8 soru → anahtar denetimi → banka + set', async () => {
    const w = world({ leaves: [leaf('tyt.mat.problem.yas')] });
    practiceHooks.keyVerifier = allVerified;
    const ctx = jobCtx({ db: w.db });
    const t0 = Date.now();
    const res = await getJob('practice.generate')!.handler!({ set_id: SET, enrollment_id: ENR }, ctx);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(res).toMatchObject({ status: 'in_progress', llm_items: 8 });
    expect(ctx.transport.requests.map((r) => r.route)).toEqual(['question_generation']);
    const llm = w.registered.find((r) => r.items.length > 0)!;
    expect(llm.set).toBe(SET);
    expect(llm.items).toHaveLength(8);
    expect(llm.items.every((i) => i.source === 'llm' && i.skill_ids[0] === 'tyt.mat.problem.yas' && i.verification.sympy === 'verified' && i.key.sympy_status === 'verified')).toBe(true);
    expect(llm.items.filter((i) => i.kind === 'numeric').map((i) => i.key.numeric_value)).toEqual(['12', '10']);
    expect(ctx.ledger.rows.map((r) => r.purpose)).toEqual(['practice.generate']);
  });

  it('şablon yarıyı karşılamazsa LLM tamamlar; set ancak sonda dolar', async () => {
    const w = world({ leaves: [leaf('a', ['islem-onceligi']), leaf('b')], fillThreshold: 1 });
    practiceHooks.templateRunner = fakeRunner(2);
    const ctx = jobCtx({ db: w.db });
    const res = await getJob('practice.generate')!.handler!({ set_id: SET, enrollment_id: ENR }, ctx);
    expect(res).toMatchObject({ status: 'in_progress', template_items: 2 });
    expect(w.registered[0]).toMatchObject({ set: null });
    // şablon varyantının öteki yaprakları korunur (hedef yaprak önce)
    expect(w.registered[0]!.items.map((i) => i.skill_ids)).toEqual([['a', 'tyt.mat.temel.sayilar'], ['a', 'tyt.mat.temel.sayilar']]);
    expect(w.registered.at(-1)!.set).toBe(SET);
    expect(ctx.transport.requests.map((r) => r.route)).toEqual(['question_generation']);
  });

  it('set artık beklemiyorsa iş hiçbir şey yazmaz', async () => {
    const w = world({ leaves: [leaf('a')], status: 'in_progress' });
    const ctx = jobCtx({ db: w.db });
    expect(await getJob('practice.generate')!.handler!({ set_id: SET, enrollment_id: ENR }, ctx)).toMatchObject({ status: 'in_progress', reason: 'not_waiting' });
    expect(w.registered).toHaveLength(0);
  });

  it('son denemede soru yoksa set generation_failed ile kapanır; ilk denemede yeniden denenir', async () => {
    const w = world({ leaves: [leaf('a')], fillThreshold: 999 });
    const first = jobCtx({ db: w.db });
    await expect(getJob('practice.generate')!.handler!({ set_id: SET, enrollment_id: ENR }, first)).rejects.toThrow(/soru üretilemedi/);
    expect(w.failed).toEqual([]);
    const last = jobCtx({ db: w.db, job: { id: 'job-1', name: 'practice.generate', retryCount: 2 } });
    await expect(getJob('practice.generate')!.handler!({ set_id: SET, enrollment_id: ENR }, last)).rejects.toThrow(/soru üretilemedi/);
    expect(w.failed).toEqual([SET]);
    expect(w.status()).toBe('abandoned');
  });
});

describe('practice.prewarm', () => {
  it('her yaprağı 8 soruya tamamlar: şablonlu yaprak şablonla, öteki yaprak başına bir LLM çağrısıyla', async () => {
    const w = world({ leaves: [leaf('a', ['islem-onceligi'], 2), leaf('b', [], 0)] });
    practiceHooks.templateRunner = fakeRunner(20);
    const ctx = jobCtx({ db: w.db });
    const res = await getJob('practice.prewarm')!.handler!({ enrollment_id: ENR, reason: 'test' }, ctx);
    expect(res).toMatchObject({ status: 'warmed', leaves: [{ skill_id: 'a', before: 2, template: 6, llm: 0 }, { skill_id: 'b', before: 0, template: 0, llm: 8 }] });
    expect(ctx.transport.requests.map((r) => r.route)).toEqual(['question_generation']);
    expect(w.registered.every((r) => r.set === null)).toBe(true);
  });

  it('alıştırması açılamayan müfredatta (otopilotsuz taslak) üretmez', async () => {
    const w = world({ leaves: [leaf('a')], practicable: false });
    const ctx = jobCtx({ db: w.db });
    expect(await getJob('practice.prewarm')!.handler!({ enrollment_id: ENR }, ctx)).toMatchObject({ status: 'skipped', reason: 'not_practicable' });
    expect(ctx.transport.requests).toHaveLength(0);
  });
});

const hasSympy = (() => {
  try {
    execFileSync('python3', ['-I', '-c', 'import sympy, matplotlib'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasSympy)('şablon doldurucu (python3 -I, gerçek içerik şablonları)', () => {
  it('şekilsiz ve şekilli şablondan tekrarsız, anahtarı doğrulanmış varyant; şekil PNG kapıdan geçer', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ogr-tpl-test-'));
    try {
      const t0 = Date.now();
      const res = await pythonTemplateRunner({ templates: [{ id: 'islem-onceligi', count: 5 }, { id: 'kesir-modeli-toplama', count: 3 }, { id: 'yok-boyle', count: 1 }], seed: 11, excludeHashes: [], out });
      expect(Date.now() - t0).toBeLessThan(10_000);
      expect(res.errors.map((e) => e.template_id)).toEqual(['yok-boyle']);
      expect(res.variants).toHaveLength(8);
      expect(new Set(res.variants.map((v) => v.content_hash)).size).toBe(8);
      for (const v of res.variants) {
        expect(v.key.sympy_status).toBe('verified');
        expect(v.key.solution.length).toBeGreaterThan(5);
        if (v.kind === 'mcq') expect(v.options.some((o) => o.key === v.key.correct_option)).toBe(true);
      }
      const fig = res.variants.find((v) => v.template_id === 'kesir-modeli-toplama')!.figure!;
      expect(fig.width_px).toBeGreaterThanOrEqual(200);
      expect(statSync(fig.file).size).toBe(fig.bytes);
      // aynı tohum + dışlanan özetler: yeni varyantlar
      const again = await pythonTemplateRunner({ templates: [{ id: 'islem-onceligi', count: 3 }], seed: 11, excludeHashes: res.variants.map((v) => v.content_hash), out });
      expect(again.variants.every((v) => !res.variants.some((x) => x.content_hash === v.content_hash))).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasSympy)('anahtar doğrulayıcı (python3 -I, SymPy)', () => {
  it('sahte LLM fikstürünün 8 anahtarı doğrulanır; yanlış anahtarlı fikstür maddesi atılır', async () => {
    const data = JSON.parse(readFileSync(new URL('../../../packages/llm/fixtures/question_generation/01-eight.json', import.meta.url), 'utf8')) as ExamGeneration;
    // yanlış anahtarlı madde: `3 + 4 · 2` için doğru şık B (11) yerine A (14); sayısal maddede 12 yerine 13
    const wrong: ExamGeneration = {
      ...data,
      items: [...data.items, { ...data.items[0]!, no: 9, stem: 'Yanlış anahtarlı: `3 + 4 · 2` kaçtır?' }, { ...data.items[6]!, no: 10, stem: 'Yanlış anahtarlı: `x/2 + x/3 = 10` ise `x` kaçtır?' }],
      keys: [...data.keys, { ...data.keys[0]!, question_no: 9, correct_option: 'A' }, { ...data.keys[6]!, question_no: 10, numeric_value: 13 }],
    };
    const mapped = mapGenerated(wrong, { curriculumId: CUR, need: new Map([['tyt.mat.temel.sayilar', 10]]), model: 'm', costUsd: 0, promptVersion: 'v', jobRef: 'j' });
    expect(mapped.items).toHaveLength(10);
    const t0 = Date.now();
    const r = await verifyKeys(mapped.items, pythonKeyVerifier);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r.summary).toMatchObject({ verified: 8, inferred: 0, dropped: 2, error: null });
    expect(r.items.some((i) => i.stem.startsWith('Yanlış anahtarlı'))).toBe(false);
    expect(r.items.every((i) => i.key.sympy_status === 'verified' && i.verification.sympy === 'verified')).toBe(true);
    expect(r.summary.details.filter((d) => d.status === 'mismatch')).toHaveLength(2);
  });

  it('canonical_expr boş ya da beyaz liste dışıysa madde inferred kalır; çok şık eşitse atılır', async () => {
    const res = await pythonKeyVerifier([
      { id: '1', kind: 'mcq', canonical_expr: null, numeric_value: null, correct_option: 'A', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }] },
      { id: '2', kind: 'numeric', canonical_expr: '__import__(1)', numeric_value: '1', correct_option: null, options: [] },
      { id: '3', kind: 'mcq', canonical_expr: '1/2', numeric_value: null, correct_option: 'A', options: [{ key: 'A', text: '`1/2`' }, { key: 'B', text: '`0,5`' }, { key: 'C', text: '2' }, { key: 'D', text: '3' }] },
      { id: '4', kind: 'mcq', canonical_expr: '5', numeric_value: null, correct_option: 'A', options: [{ key: 'A', text: 'Ali' }, { key: 'B', text: 'Ayşe' }, { key: 'C', text: 'Can' }, { key: 'D', text: 'Ece' }] },
    ]);
    expect(res.map((r) => r.status)).toEqual(['inferred', 'inferred', 'ambiguous', 'inferred']);
  });
});
