/**
 * document.generate birim testleri (sahte veritabanı yönlendiricisi + sahte LLM): taslak dönüşümleri (exam → AST,
 * blok çıkarma ve yeniden numaralama, LaTeX → SymPy), figürlerin yerel yolu (python3 -I matplotlib, kum havuzu,
 * boş/boyut denetimi), merdiven basamakları (SymPy uyuşmazlığı → yalnız o blok yeniden üretilir; kaynaksız hata kutusu
 * hak bitince çıkar; çizilemeyen figür çıkar) ve işin tamamı (sahte fikstür → PDF + HTML Storage'da, durum geçişleri,
 * kodsuz/anahtarsız AST, yeniden üretim kaydı).
 */
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { documentAst, storedDocumentAst, type DocumentAst, type ExamGeneration } from '@ogrenmen/contracts';
import { closeBrowser } from '@ogrenmen/doc-render';
import { FakeTransport, type Gateway } from '@ogrenmen/llm';
import { difficultySplit, examSections, normalizePatternId, type SkillRow } from '../src/documents/context.js';
import { buildDraft, CALLOUT_SLOT, dropBlocks, examToAst, figureTasks, latexToPlain, mergeExam, mergeNotes, type AstMeta } from '../src/documents/draft.js';
import { FigureCache, localFigureRun, rasterize, renderAndCheckFigures, type FigureEnv } from '../src/documents/figures.js';
import { runLadder, type Issue, type LadderEnv } from '../src/documents/ladder.js';
import { figureIsolation, isolatedCommand, resetFigureIsolation } from '../src/documents/sandbox.js';
import { documentHooks, figuresMode, regenUserText } from '../src/jobs/document-generate.js';
import { getJob } from '../src/jobs/registry.js';
import { silentLogger } from '../src/log.js';
import type { KeyVerifier } from '../src/practice/bank.js';
import type { StorageLike } from '../src/storage.js';
import { jobCtx, routedDb, type Route } from './support.js';

const NOTES = JSON.parse(readFileSync(new URL('../../../packages/llm/fixtures/notes_generation/01-rasyonel.json', import.meta.url), 'utf8')) as DocumentAst;
const EXAM = JSON.parse(readFileSync(new URL('../../../packages/llm/fixtures/exam_generation/01-tyt10.json', import.meta.url), 'utf8')) as ExamGeneration;
const SKILLS = (JSON.parse(readFileSync(new URL('../../../content/tyt-matematik/skills.json', import.meta.url), 'utf8')) as { id: string; parent_id: string | null; name: string; is_leaf: boolean }[]).map(
  (s, i): SkillRow => ({ id: s.id, parent_id: s.parent_id, name: s.name, is_leaf: s.is_leaf, order_no: i }),
);
const META: AstMeta = { title: 'Deneme', courseTitle: 'TYT Matematik', generatedOn: '2026-11-04', personalized: false, durationMin: 20 };
const DOC = '44444444-4444-4444-8444-444444444444';
const CUR = '33333333-3333-4333-8333-333333333333';

function hasPython(): boolean {
  try {
    execFileSync('python3', ['-c', 'import matplotlib, numpy, sympy'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const PY = hasPython();
const ISO = PY ? await figureIsolation() : ({ ok: false, reason: 'python yok' } as const);
/** Test kodu güvenilir: yalıtım varsa onun içinde, yoksa (CI'da kullanıcı ad alanı kapalı olabilir) yalıtımsız koşar. */
const runTrusted = (code: string) => localFigureRun({ code, file_name: 'figure_1.svg' }, undefined, { trusted: true });

/** Doğrulayıcı: verilen blok kimlikleri uyuşmaz, kalanı doğrulanır. */
const verifierFailing = (bad: Set<string>): KeyVerifier => async (items) => items.map((i) => ({ id: i.id, status: bad.has(i.id) ? 'mismatch' : 'verified', detail: bad.has(i.id) ? 'şık B eşit' : 'ok' }));

class MemoryStorage implements StorageLike {
  readonly objects = new Map<string, { body: Buffer; type: string }>();
  readonly removed: string[] = [];
  async remove(bucket: string, paths: string[]): Promise<void> {
    for (const p of paths) {
      this.removed.push(`${bucket}/${p}`);
      this.objects.delete(`${bucket}/${p}`);
    }
  }
  async upload(bucket: string, path: string, body: Uint8Array | Buffer, contentType: string): Promise<void> {
    this.objects.set(`${bucket}/${path}`, { body: Buffer.from(body), type: contentType });
  }
  async download(): Promise<Buffer> {
    throw new Error('yok');
  }
  async createSignedUrl(): Promise<string> {
    return '';
  }
}

afterEach(() => {
  delete documentHooks.keyVerifier;
  delete documentHooks.figureRun;
  delete documentHooks.visionCheck;
  delete documentHooks.figuresMode;
});
afterAll(async () => {
  await closeBrowser().catch(() => undefined);
});

describe('taslak', () => {
  it('LaTeX → SymPy/şık sözdizimi', () => {
    expect(latexToPlain('$\\frac{7}{8}$')).toBe('((7)/(8))');
    expect(latexToPlain('$-\\dfrac{3}{6}$')).toBe('-((3)/(6))');
    expect(latexToPlain('$2\\sqrt{3}$')).toBe('2sqrt(3)');
    expect(latexToPlain('$2^{10}$')).toBe('2**(10)');
    expect(latexToPlain('$3 \\cdot 4$')).toBe('3 * 4');
    expect(latexToPlain('$\\frac{1}{2$')).toBe('$\\frac{1}{2$'); // kapanmayan grup: girdi aynen
    expect(latexToPlain('$\\alpha$')).toBe('$\\alpha$');
  });

  it('exam-generation → belge AST: bölümler blueprint\'ten, q<no> kimlikleri, kodlu şekiller, optik form + anahtar sayfası', () => {
    const ast = examToAst('mock_exam', EXAM, META);
    expect(documentAst.safeParse(ast).success).toBe(true);
    expect(ast.sections.map((s) => s.title)).toEqual(['Sayılar', 'Problemler', 'Cebir']);
    const qs = ast.blocks.filter((b) => b.type === 'question');
    expect(qs).toHaveLength(10);
    expect(qs[7]).toMatchObject({ id: 'q8', section_no: 2, figure: { source: 'svg', kind: 'matplotlib' } });
    expect(ast.blocks.slice(-3).map((b) => b.type)).toEqual(['page_break', 'answer_sheet', 'answer_key_page']);
    expect(ast.keys).toHaveLength(10);
    expect(ast.meta).toMatchObject({ subtitle: '10 soru · 20 dakika', duration_min: 20, personalized: false });
    const tasks = figureTasks(ast);
    expect(tasks.map((t) => [t.block_id, t.kind])).toEqual([['q8', 'matplotlib'], ['q9', 'svg']]);
    expect(tasks[0]!.context).toContain('ortalama');
    expect(tasks[1]!.hidden).toEqual(['8']); // |AB| = 8 şekilde yazılmamalı
    expect(examToAst('question_set', EXAM, META).blocks.some((b) => b.type === 'answer_sheet')).toBe(false);
  });

  it('kesir cevabı: 11/12 ve ham yazımı (\\frac) figür denetiminde ele verilmez sayılır', () => {
    const base = examToAst('question_set', EXAM, META);
    const i = base.blocks.findIndex((b) => b.id === 'q8');
    const q = base.blocks[i] as Extract<(typeof base.blocks)[number], { type: 'question' }>;
    const options = q.options.map((o, j) => (j === 0 ? { ...o, text: '$\\frac{11}{12}$' } : o));
    const blocks = base.blocks.map((b, j) => (j === i ? { ...q, options } : b));
    const keys = base.keys.map((k) => (k.question_no === q.no ? { ...k, correct_option: 'A' as const, numeric_value: null } : k));
    const tasks = figureTasks({ ...base, blocks, keys });
    expect(tasks.find((t) => t.block_id === 'q8')!.hidden).toEqual(['11/12', '$\\frac{11}{12}$']);
  });

  it('blok çıkarma: sorular, anahtarlar ve optik form yeniden numaralanır', () => {
    const ast = examToAst('mock_exam', EXAM, META);
    const { ast: out, renumber } = dropBlocks(ast, new Set(['q2', 'q5']));
    const qs = out.blocks.filter((b) => b.type === 'question') as { no: number; id: string }[];
    expect(qs.map((q) => q.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(renumber.get(3)).toBe(2);
    expect(out.keys.map((k) => k.question_no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out.keys[1]!.correct_option).toBe(EXAM.keys[2]!.correct_option);
    expect(out.blocks.find((b) => b.type === 'answer_sheet')).toMatchObject({ question_count: 8 });
    expect(documentAst.safeParse(out).success).toBe(true);
  });

  it('deneme birleştirme: yalnız istenen soru ve anahtarı değişir', () => {
    const next: ExamGeneration = { ...EXAM, items: EXAM.items.map((it) => ({ ...it, stem: `${it.stem} (yeni)` })), keys: EXAM.keys.map((k) => ({ ...k, solution: 'yeni çözüm adım adım' })) };
    const { exam, replaced } = mergeExam(EXAM, next, new Set(['q3']));
    expect(replaced).toEqual(['q3']);
    expect(exam.items.filter((it) => it.stem.endsWith('(yeni)')).map((it) => it.no)).toEqual([3]);
    expect(exam.keys.find((k) => k.question_no === 3)!.solution).toBe('yeni çözüm adım adım');
  });

  it('kapsam: bölümler en üst ataya göre, zorluk bantları toplamı tutar, örüntü kimliği', () => {
    const leaves = SKILLS.filter((s) => s.is_leaf);
    const secs = examSections(SKILLS, leaves, 10);
    expect(secs.reduce((a, s) => a + s.count, 0)).toBe(10);
    expect(secs.map((s) => s.name)).toEqual(['Temel matematik', 'Problemler', 'Cebir']);
    expect(difficultySplit(10, 'mixed')).toEqual({ easy: 3, medium: 5, hard: 2 });
    expect(difficultySplit(7, 'hard')).toEqual({ easy: 1, medium: 3, hard: 3 });
    expect(normalizePatternId('patterns.md#2')).toBe('patterns.md:2');
  });

  it('yeniden üretim metni yalnız sorunlu blokları veri olarak taşır; modele ayrıntı (detail) gider', () => {
    const t = regenUserText('notes', [{ block_id: 'q2', no: 2, step: 'sympy', reason: 'soru 2 anahtarı doğrulanamadı', detail: 'anahtar <tutmuyor>: doğru şık B' }]);
    expect(t).toContain('<regen_blocks>');
    expect(t).toContain('"block_id": "q2"');
    expect(t).toContain('doğru şık B');
    expect(t).not.toContain('<tutmuyor>');
    expect(regenUserText('notes', [{ block_id: CALLOUT_SLOT, step: 'personalization', reason: 'kutu yok' }])).toContain('yeni bir common_mistake_callout bloğu ekle');
  });

  it('not birleştirme: @callout istenince yeni hata kutusu öncül bloğunun ardına eklenir', () => {
    const without = { ...NOTES, blocks: NOTES.blocks.filter((b) => b.type !== 'common_mistake_callout') };
    const { doc, replaced } = mergeNotes(without, NOTES, new Set([CALLOUT_SLOT]));
    expect(replaced).toEqual([CALLOUT_SLOT]);
    expect(doc.blocks.map((b) => b.id)).toEqual(NOTES.blocks.map((b) => b.id));
    expect(mergeNotes(without, without, new Set([CALLOUT_SLOT])).replaced).toEqual([]);
  });

  it('figür kipi: sahte LLM → local; gerçek anahtar → code_execution (OGRENMEN_FIGURES=local açıkça verilmedikçe)', () => {
    const real = { transport: { kind: 'anthropic', files: {} } } as unknown as Gateway;
    const noFiles = { transport: { kind: 'anthropic' } } as unknown as Gateway;
    const fake = { transport: new FakeTransport() } as unknown as Gateway;
    expect(figuresMode('auto', real)).toBe('code_execution');
    expect(figuresMode('code_execution', real)).toBe('code_execution');
    expect(figuresMode('local', real)).toBe('local');
    expect(figuresMode('auto', fake)).toBe('local');
    expect(figuresMode('code_execution', fake)).toBe('local');
    expect(figuresMode('auto', noFiles)).toBe('local');
  });
});

describe.skipIf(!PY)('figürler (yerel matplotlib)', () => {
  const code = NOTES.blocks.find((b) => b.type === 'figure' && b.figure_code) as { figure_code: string };

  it('fikstür figürü çizilir: SVG → 640 px PNG, boş değil', async () => {
    const r = await runTrusted(code.figure_code);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toContain('<svg');
    const raster = await rasterize(r.svg);
    expect(raster).toMatchObject({ ok: true, width_px: 640 });
  });

  it('kum havuzu: izin dışı modül, yerleşik ve öznitelik reddedilir; çalışmayan kod hata döner', async () => {
    for (const bad of [
      'import os\nsave_figure(plt.figure(), 1)',
      'import subprocess',
      'open("x.txt", "w")',
      'x = plt.matplotlib.os',
      'fig = plt.figure()\nfig.savefig("/tmp/x.svg")',
      'print(().__class__)',
      // bulgu: sympy dizeyi eval eder (sympify → parse_expr)
      "import sympy\nx = sympy.S('_'+'_import_'+'_(\"os\").getpid()')",
      "from sympy import S\nx = S('1')",
      "x = S('_'+'_import_'+'_(\"os\")')",
      // dosya okuma ve alt süreç yolları
      "import numpy as np\nf = np.lib.npyio.DataSource().open('/proc/1/environ')",
      "import matplotlib\nmatplotlib.rcParams['animation.ffmpeg_path'] = 'sh'\nimport matplotlib.animation",
      'from matplotlib import animation',
      'import numpy.f2py',
      'from numpy import f2py',
      'fig = plt.figure()\nfig.canvas.print_svg("x.svg")',
    ]) {
      const r = await runTrusted(bad);
      expect(r.ok, bad).toBe(false);
      expect((r as { error: string }).error).toMatch(/izin verilmeyen|sözdizimi/);
    }
    const none = await runTrusted('fig, ax = plt.subplots()\nax.plot([1, 2], [3, 4])');
    expect(none).toMatchObject({ ok: false, error: expect.stringContaining('üretilmedi') });
    const crash = await runTrusted('fig, ax = plt.subplots()\nax.plot([1, 2], [3])\nsave_figure(fig, 1)');
    expect(crash).toMatchObject({ ok: false, error: expect.stringContaining('ValueError') });
  });

  it('sonsuz döngü 11 sn içinde durur (CPU/zaman sınırı); bellek sınırı', async () => {
    const t0 = Date.now();
    const loop = await runTrusted('while True:\n    pass');
    expect(Date.now() - t0).toBeLessThanOrEqual(11_000);
    expect(loop).toMatchObject({ ok: false, error: expect.stringMatching(/sn içinde bitmedi|CPU sınırını/) });
    const t1 = Date.now();
    const sleep = await runTrusted('plt.pause(1e6)');
    expect(Date.now() - t1).toBeLessThanOrEqual(11_000);
    expect(sleep).toMatchObject({ ok: false, error: expect.stringMatching(/sn içinde bitmedi|CPU sınırını/) });
    const mem = await runTrusted('import numpy as np\nx = np.ones(10**10)');
    expect(mem).toMatchObject({ ok: false, error: expect.stringMatching(/bellek/) });
  }, 30_000);

  it('yalıtım kurulamazsa model kodu çalışmaz; yalnız güvenilir (sahte) kod yalıtımsız', async () => {
    const saved = process.env.OGRENMEN_PYTHON;
    process.env.OGRENMEN_PYTHON = '/yok/python3';
    resetFigureIsolation();
    try {
      const r = await localFigureRun({ code: 'fig = plt.figure()\nsave_figure(fig, 1)', file_name: 'figure_1.svg' });
      expect(r).toMatchObject({ ok: false, error: expect.stringContaining('yalıtımsız çalıştırılmaz') });
    } finally {
      if (saved === undefined) delete process.env.OGRENMEN_PYTHON;
      else process.env.OGRENMEN_PYTHON = saved;
      resetFigureIsolation();
    }
  });

  it('boş SVG ve küçük SVG reddedilir', async () => {
    expect(await rasterize('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200"><rect width="640" height="200" fill="#f6f8fc"/></svg>')).toMatchObject({ ok: false, reason: 'figür boş (tek renk)' });
    expect((await rasterize('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="10"><rect width="640" height="10" fill="#000"/></svg>')).ok).toBe(false);
  });

  it('figure_check (Haiku) uyuşmazlık bildirirse figür sorunlu sayılır; aynı SVG ikinci kez denetlenmez', async () => {
    const transport = new FakeTransport();
    transport.enqueue('figure_check', { json: { matches_stem: false, status: 'mismatch', mismatches: [{ field: 'answer_leak', expected: null, observed: '8', note: 'cevap yazılı' }], notes: null } });
    const ctx = jobCtx({ transport });
    const env: FigureEnv = { gateway: await ctx.gateway(), mode: 'local', prompt: { text: 'p', version: 'v1' }, ref: { table: 'generated_documents', id: DOC }, studentRef: null };
    const tasks = figureTasks(examToAst('mock_exam', EXAM, META)).filter((t) => t.kind === 'svg');
    const cache = new FigureCache();
    const r1 = await renderAndCheckFigures(env, tasks, new Map(), cache);
    expect(r1[0]).toMatchObject({ block_id: 'q9', ok: false, check: 'mismatch' });
    expect(r1[0]!.reason).toContain('answer_leak');
    const r2 = await renderAndCheckFigures(env, tasks, new Map(), cache);
    expect(r2[0]!.ok).toBe(false);
    expect(transport.requests.filter((r) => r.route === 'figure_check')).toHaveLength(1);
  });
});

describe.skipIf(!ISO.ok)('OS yalıtımı (figür kodu)', () => {
  it('yalıtım içindeki kod worker ve kardeş süreçlerin ortamını okuyamaz, ağa çıkamaz, örtüleri kaldıramaz', async () => {
    if (!ISO.ok) return;
    // sır taşıyan kardeş süreç (worker'ın kendisi gibi: DATABASE_URL, servis anahtarı …)
    const sibling = spawn('sleep', ['30'], { env: { ...process.env, SECRET_TEST: 'sentinel123' }, stdio: 'ignore' });
    process.env.SECRET_TEST = 'sentinel123';
    try {
      const probe = [
        'import glob, json, os, socket, subprocess',
        'found = []',
        `for p in glob.glob("/proc/*/environ") + ["/proc/${sibling.pid}/environ", "/proc/${process.pid}/environ"]:`,
        '    try:',
        '        if b"sentinel123" in open(p, "rb").read(): found.append(p)',
        '    except OSError:',
        '        pass',
        'try:',
        '    socket.create_connection(("1.1.1.1", 53), 1); net = "open"',
        'except OSError as e:',
        '    net = "closed"',
        'um = subprocess.run(["umount", "/home"], capture_output=True).returncode',
        `print(json.dumps({"found": found, "env": "sentinel123" in json.dumps(dict(os.environ)), "pids": sorted(p for p in os.listdir("/proc") if p.isdigit()), "net": net, "umount": um, "home": os.listdir("/home") if os.path.isdir("/home") else [], "cwd_repo": os.path.exists(${JSON.stringify(process.cwd())} + "/package.json")}))`,
      ].join('\n');
      const cmd = isolatedCommand(ISO, probe);
      const out = execFileSync(cmd.command, cmd.args, { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', SECRET_TEST: 'sentinel123' }, timeout: 20_000 }).toString();
      const r = JSON.parse(out) as { found: string[]; env: boolean; pids: string[]; net: string; umount: number; home: string[]; cwd_repo: boolean };
      expect(r.found).toEqual([]);
      expect(r.env).toBe(false);
      expect(r.pids).toEqual(['1']);
      expect(r.net).toBe('closed');
      expect(r.umount).not.toBe(0);
      expect(r.home).toEqual([]);
      expect(r.cwd_repo).toBe(false);
    } finally {
      sibling.kill('SIGKILL');
      delete process.env.SECRET_TEST;
    }
  }, 30_000);
});

// ------------------------------------------------------------------------------------------------ merdiven

async function ladderEnv(over: Partial<LadderEnv> & { transport?: FakeTransport } = {}): Promise<LadderEnv & { regenCalls: Issue[][]; notes: Issue[] }> {
  const ctx = jobCtx(over.transport ? { transport: over.transport } : {});
  const gateway = await ctx.gateway();
  const regenCalls: Issue[][] = [];
  const notes: Issue[] = [];
  const { transport: _t, ...rest } = over;
  return {
    db: routedDb(),
    log: silentLogger,
    gateway,
    docId: DOC,
    curriculumId: CUR,
    ref: { table: 'generated_documents', id: DOC },
    studentRef: null,
    verifier: verifierFailing(new Set()),
    figures: { gateway, mode: 'local', prompt: { text: 'p', version: 'v1' }, ref: { table: 'generated_documents', id: DOC }, studentRef: null, visionCheck: false, run: async () => ({ ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200"><rect width="640" height="200" fill="#f6f8fc"/><circle cx="100" cy="100" r="60" fill="#0030a2"/></svg>' }) },
    remoteFigures: new Map(),
    personalized: true,
    known: [{ source: 'patterns.md', id: 'patterns.md:2', dates: ['2026-10-12', '2026-10-19'] }],
    patterns: [{ source: 'patterns.md', id: 'patterns.md:2', dates: ['2026-10-12', '2026-10-19'], skill_code: null, summary: 'Paydaları topluyor', count: 2 }],
    personalizationPrompt: { text: 'p', version: 'v1' },
    maxRounds: 2,
    noteRegen: async (issue) => {
      notes.push(issue);
      return { allowed: notes.filter((n) => n.block_id === issue.block_id).length <= 2 };
    },
    regenerate: async (draft, issues) => {
      regenCalls.push([...issues]);
      return { draft, replaced: [], costUsd: 0 };
    },
    regenCalls,
    notes,
    ...rest,
  } as LadderEnv & { regenCalls: Issue[][]; notes: Issue[] };
}

const notesMeta: AstMeta = { title: 'Rasyonel sayılar', courseTitle: 'TYT Matematik', generatedOn: '2026-11-04', personalized: true, durationMin: null };

describe('doğrulama merdiveni', () => {
  it('temiz not: bütün basamaklar geçer, figür SVG yazılır, kod kalmaz', async () => {
    const env = await ladderEnv();
    const r = await runLadder(env, buildDraft('notes', NOTES, notesMeta), { route: 'notes_generation', repaired: false });
    expect(r.ok).toBe(true);
    expect(r.rounds).toBe(0);
    expect(r.verification).toMatchObject({
      schema: { status: 'pass' },
      sympy: { status: 'pass', checked: 3, verified: 3 },
      figures: { status: 'pass', count: 1, rendered: [{ block_id: 'b4', via: 'local', check: 'skipped' }] },
      duplicates: { status: 'pass', checked: 3, bank_matches: [] },
      personalization: { status: 'pass', callouts: 1, model_check: 'ok' },
    });
    const fig = r.final.blocks.find((b) => b.id === 'b4') as { svg?: string; figure_code?: string };
    expect(fig.svg).toMatch(/^<svg/);
    expect(fig.figure_code).toBeUndefined();
    expect(storedDocumentAst.safeParse({ ...r.final, keys: [] }).success).toBe(true);
  });

  it('SymPy uyuşmazlığı: yalnız o soru yeniden istenir; düzelince geçer', async () => {
    const bad = new Set(['q2']);
    const env = await ladderEnv({ verifier: async (items) => items.map((i) => ({ id: i.id, status: bad.has(i.id) && !i.options.some((o) => o.text.includes('99')) ? 'mismatch' : 'verified', detail: '' })) });
    env.regenerate = async (draft, issues) => {
      env.regenCalls.push([...issues]);
      const raw = structuredClone(draft.raw) as DocumentAst;
      const q = raw.blocks.find((b) => b.id === 'q2') as { options: { key: string; text: string }[] };
      q.options[4]!.text = '$99$';
      return { draft: buildDraft('notes', raw, notesMeta), replaced: ['q2'], costUsd: 0.01 };
    };
    const r = await runLadder(env, buildDraft('notes', NOTES, notesMeta), { route: 'notes_generation', repaired: false });
    expect(env.regenCalls).toEqual([[{ block_id: 'q2', no: 2, step: 'sympy', reason: 'soru 2 anahtarı doğrulanamadı', detail: 'soru 2 anahtarı tutmuyor: ' }]]);
    expect(r).toMatchObject({ ok: true, rounds: 1 });
    expect(r.costUsd).toBeGreaterThanOrEqual(0.01); // + personalization_check
    expect(r.final.blocks.filter((b) => b.type === 'question')).toHaveLength(3);
  });

  it('hak bitince: hatalı soru çıkar ve yeniden numaralanır; kaynaksız hata kutusu çıkar', async () => {
    const env = await ladderEnv({ verifier: verifierFailing(new Set(['q1'])), known: [] });
    const r = await runLadder(env, buildDraft('notes', NOTES, notesMeta), { route: 'notes_generation', repaired: false });
    expect(r.ok).toBe(true);
    expect(r.rounds).toBe(2);
    expect(env.regenCalls.map((c) => c.map((i) => i.block_id).sort())).toEqual([['b6', 'q1'], ['b6', 'q1']]);
    expect(env.notes.filter((n) => n.block_id === 'q1')).toHaveLength(2); // tur sınırı: üçüncü istenmez
    expect(r.final.blocks.some((b) => b.type === 'common_mistake_callout')).toBe(false);
    expect(r.final.blocks.filter((b) => b.type === 'question').map((b) => (b as { no: number }).no)).toEqual([1, 2]);
    expect(r.final.keys.map((k) => k.correct_option)).toEqual(['A', 'C']);
    expect(r.verification.sympy).toMatchObject({ status: 'pass', dropped: [{ block_id: 'q1', no: 1 }] });
    expect(r.verification.personalization).toMatchObject({ status: 'pass', personalized: false, callouts: 0, removed: [{ block_id: 'b6', reason: expect.stringContaining('örüntülerinde olmayan') }] });
    // kutu kalmadı: not kişisel sayılmaz (kapak genel metne döner)
    expect(r.final.meta.personalized).toBe(false);
  });

  it('anahtar ayrıntısı saklanan verification\'a girmez (öğrenci okur); yalnız modele gider', async () => {
    const env = await ladderEnv({ verifier: async (items) => items.map((i) => ({ id: i.id, status: i.id === 'q1' ? 'mismatch' : 'verified', detail: i.id === 'q1' ? 'doğru şık B canonical_expr 11/12\'e eşit değil' : 'doğru şık C = 7/8' })) });
    const r = await runLadder(env, buildDraft('notes', NOTES, notesMeta), { route: 'notes_generation', repaired: false });
    const stored = JSON.stringify(r.verification);
    expect(stored).not.toMatch(/doğru şık|canonical_expr|11\/12|7\/8/);
    expect(r.verification.sympy).toMatchObject({ details: [{ no: 1, status: 'mismatch' }, { no: 2, status: 'verified' }, { no: 3, status: 'verified' }] });
    expect(env.notes.every((n) => !/doğru şık|11\/12/.test(n.reason))).toBe(true);
    expect(env.regenCalls[0]![0]).toMatchObject({ block_id: 'q1', reason: 'soru 1 anahtarı doğrulanamadı', detail: expect.stringContaining('11/12') });
  });

  it('doğrulayıcı çalışmazsa sympy basamağı skipped; deneme incelemeye düşer, not düşmez', async () => {
    const broken: KeyVerifier = async () => {
      throw new Error('python3 yok');
    };
    const exam = await runLadder(await ladderEnv({ verifier: broken, personalized: false }), buildDraft('question_set', EXAM, META), { route: 'exam_generation', repaired: false });
    expect(exam.ok).toBe(true);
    expect(exam.verification.sympy).toMatchObject({ status: 'skipped', reason: 'doğrulayıcı çalışmadı' });
    expect(exam.reviewRequired).toBe(true);
    const notes = await runLadder(await ladderEnv({ verifier: broken }), buildDraft('notes', NOTES, notesMeta), { route: 'notes_generation', repaired: false });
    expect(notes.verification.sympy.status).toBe('skipped');
    expect(notes.reviewRequired).toBe(false);
  });

  it('kişisel notta hiç hata kutusu yoksa belge düzeyinde istenir; eklenince geçer', async () => {
    const without = { ...NOTES, blocks: NOTES.blocks.filter((b) => b.type !== 'common_mistake_callout') };
    const env = await ladderEnv();
    env.regenerate = async (draft, issues) => {
      env.regenCalls.push([...issues]);
      const m = mergeNotes(draft.raw as typeof NOTES, NOTES, new Set(issues.map((i) => i.block_id)));
      return { draft: buildDraft('notes', m.doc, notesMeta), replaced: m.replaced, costUsd: 0 };
    };
    const r = await runLadder(env, buildDraft('notes', without, notesMeta), { route: 'notes_generation', repaired: false });
    expect(env.regenCalls[0]).toEqual([expect.objectContaining({ block_id: CALLOUT_SLOT, step: 'personalization' })]);
    expect(r).toMatchObject({ ok: true, rounds: 1 });
    expect(r.final.meta.personalized).toBe(true);
    expect(r.verification.personalization).toMatchObject({ status: 'pass', personalized: true, callouts: 1 });
  });

  it('kişisel notta kutu hiç gelmezse: haklar biter, not kişisel sayılmaz', async () => {
    const without = { ...NOTES, blocks: NOTES.blocks.filter((b) => b.type !== 'common_mistake_callout') };
    const env = await ladderEnv();
    const r = await runLadder(env, buildDraft('notes', without, notesMeta), { route: 'notes_generation', repaired: false });
    expect(env.regenCalls).toHaveLength(2);
    expect(r.ok).toBe(true);
    expect(r.final.meta.personalized).toBe(false);
    expect(r.verification.personalization).toMatchObject({ status: 'pass', personalized: false, callouts: 0, removed: [{ block_id: CALLOUT_SLOT }] });
  });

  it('çizilemeyen figür: yeniden istenir, düzelmezse figürsüz devam (verification notu)', async () => {
    const env = await ladderEnv({ figures: { ...(await ladderEnv()).figures, run: async () => ({ ok: false, error: 'NameError: x' }) } });
    const r = await runLadder(env, buildDraft('notes', NOTES, notesMeta), { route: 'notes_generation', repaired: false });
    expect(r.ok).toBe(true);
    expect(env.regenCalls).toHaveLength(2);
    expect(r.final.blocks.some((b) => b.id === 'b4')).toBe(false);
    expect(r.verification.figures).toMatchObject({ status: 'pass', removed: [{ block_id: 'b4', reason: expect.stringContaining('NameError') }] });
  });

  it('kişiselleştirme: Haiku sorunlu kutuyu bildirirse yeniden istenir', async () => {
    const transport = new FakeTransport();
    transport.enqueue('personalization_check', { json: { ok: false, offending_block_ids: ['b6'], findings: [{ block_id: 'b6', problem: 'text_mismatch', note: 'metin örüntüyü anlatmıyor' }] } });
    const env = await ladderEnv({ transport });
    const r = await runLadder(env, buildDraft('notes', NOTES, notesMeta), { route: 'notes_generation', repaired: false });
    expect(env.regenCalls[0]).toEqual([{ block_id: 'b6', step: 'personalization', reason: 'kutu metni başvurduğu örüntüyü anlatmıyor: metin örüntüyü anlatmıyor' }]);
    expect(r.verification.personalization).toMatchObject({ status: 'pass', model_check: 'issues' });
  });

  it('deneme sorusuz kalırsa basamak fail ve Türkçe neden', async () => {
    const env = await ladderEnv({ verifier: verifierFailing(new Set(EXAM.items.map((i) => `q${i.no}`))), personalized: false });
    const r = await runLadder(env, buildDraft('question_set', EXAM, META), { route: 'exam_generation', repaired: false });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Sorular doğrulamadan geçmedi; belge hazırlanamadı.');
    expect(r.verification.sympy.status).toBe('fail');
  });
});

// ------------------------------------------------------------------------------------------------ iş

describe('document.generate işi', () => {
  it('yük: document_id ya da request_id', () => {
    const job = getJob('document.generate')!;
    expect(job.handler).not.toBeNull();
    expect(job.payload.safeParse({ document_id: DOC, request_id: DOC, kind: 'notes', student_id: null }).success).toBe(true);
    expect(job.payload.safeParse({ requestId: DOC }).success).toBe(true);
    expect(job.payload.safeParse({ kind: 'notes' }).success).toBe(false);
    expect(job.payload.safeParse({ document_id: 'x' }).success).toBe(false);
  });

  it('ders geneli not (sahte fikstür): kaynaksız kutu çıkar, PDF + HTML Storage\'da, ready isteği incelemeye döner', async () => {
    const statuses: { status: string; patch: Record<string, unknown> }[] = [];
    const registers: Record<string, unknown>[] = [];
    const regen: unknown[][] = [];
    const routes: Route[] = [
      [/with target as/, () => [{ id: DOC, kind: 'notes', title: 'Rasyonel sayılar', spec: { topic: 'Rasyonel sayılar', skill_ids: ['tyt.mat.temel.rasyonel-sayilar'], length: 'short' }, status: 'queued', student_id: null, course_id: null, review_required: true, cost_usd: 0, content: null, request_id: DOC, request_status: 'queued', enrollment_id: null, message_id: null }]],
      [/from \(select 1\) one/, () => [{ curriculum_id: CUR, course_title: 'TYT Matematik', target_exam: null, student_ref: null }]],
      [/from public\.skills s/, () => SKILLS as unknown as Record<string, unknown>[]],
      [/document_set_status/, (v) => {
        statuses.push({ status: String(v![1]), patch: JSON.parse(String(v![2])) as Record<string, unknown> });
        return [{ r: { status: v![1] === 'ready' ? 'review' : v![1] } }];
      }],
      [/document_block_regen_note/, (v) => {
        regen.push(v!);
        return [{ r: { attempts: v![4], max: 2 } }];
      }],
      [/register_generated_document/, (v) => {
        registers.push(JSON.parse(String(v![0])) as Record<string, unknown>);
        return [{ id: DOC }];
      }],
      [/from public\.llm_calls/, () => [{ s: 0 }]],
      [/select cost_usd/, () => [{ c: 0 }]],
    ];
    const storage = new MemoryStorage();
    documentHooks.keyVerifier = verifierFailing(new Set());
    documentHooks.visionCheck = false;
    if (!PY) documentHooks.figureRun = async () => ({ ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200"><rect width="640" height="200" fill="#f6f8fc"/><circle cx="100" cy="100" r="60" fill="#0030a2"/></svg>' });
    const ctx = jobCtx({ db: routedDb(routes), storage: () => storage });
    const res = await getJob('document.generate')!.handler!({ document_id: DOC }, ctx);
    expect(res).toMatchObject({ document_id: DOC, status: 'review', figures: 'local', regen_rounds: 2 });
    expect(statuses.map((s) => s.status)).toEqual(['generating', 'verifying', 'ready']);
    const final = statuses.at(-1)!.patch as { verification: Record<string, { status: string }>; review_required: boolean; personalization: Record<string, unknown> };
    expect(final.review_required).toBe(true);
    expect(Object.fromEntries(Object.entries(final.verification).map(([k, v]) => [k, v.status]))).toEqual({ schema: 'pass', sympy: 'pass', figures: 'pass', duplicates: 'pass', personalization: 'pass' });
    expect(final.personalization).toMatchObject({ personalized: false, patterns_offered: 0, callouts: [] });
    // ders geneli not kişisel başvuru taşıyamaz: kutu 2 tur yeniden istendi, sonra çıktı
    expect(regen.filter((r) => r[1] === 'b6').map((r) => r[4])).toEqual([1, 2]);
    expect(ctx.transport.requests.filter((r) => r.route === 'notes_generation')).toHaveLength(3);
    const content = registers[0]!.content as DocumentAst;
    expect(content.keys).toEqual([]);
    expect(JSON.stringify(content)).not.toContain('figure_code');
    expect(content.blocks.some((b) => b.type === 'common_mistake_callout')).toBe(false);
    expect(registers[1]).toMatchObject({ html_path: `notes/course-none/${DOC}.html`, pdf_path: `notes/course-none/${DOC}.pdf` });
    const pdf = storage.objects.get(`documents/notes/course-none/${DOC}.pdf`)!;
    expect(pdf.type).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(storage.objects.get(`documents/notes/course-none/${DOC}.html`)!.body.toString('utf8')).toContain('Kendini sına');
    expect(ctx.enqueued).toEqual([]); // incelemede: bildirim/push yok
  }, 60_000);

  it('son denemede hata: belge failed + Türkçe neden, AST silinir', async () => {
    const calls: { status: string; patch: Record<string, unknown> }[] = [];
    const sql: string[] = [];
    const row = { id: DOC, kind: 'notes', title: 'X', spec: {}, status: 'generating', student_id: null, course_id: null, review_required: false, cost_usd: 0, content: null, request_id: DOC, request_status: 'generating', enrollment_id: null, message_id: null };
    const routes: Route[] = [
      [/with target as/, () => [row]],
      [/from \(select 1\) one/, () => [{ curriculum_id: null, course_title: null, target_exam: null, student_ref: null }]],
      [/document_set_status/, (v) => {
        calls.push({ status: String(v![1]), patch: JSON.parse(String(v![2])) as Record<string, unknown> });
        return [{ r: { status: v![1] } }];
      }],
      [/update public\.generated_documents set content = null/, (_v, t) => {
        sql.push(t);
        return [];
      }],
    ];
    const storage = new MemoryStorage();
    await storage.upload('documents', `notes/course-none/${DOC}.pdf`, Buffer.from('%PDF-'), 'application/pdf');
    const ctx = jobCtx({ db: routedDb(routes), storage: () => storage });
    await expect(getJob('document.generate')!.handler!({ document_id: DOC }, ctx)).rejects.toThrow(/müfredatı yok/);
    expect(calls).toEqual([{ status: 'failed', patch: { error: 'Bu dersin müfredatı bulunamadı.' } }]);
    expect(sql).toHaveLength(1);
    // kısmi belge saklanmaz: Storage'daki HTML/PDF de silinir
    expect(storage.removed).toEqual([`documents/notes/course-none/${DOC}.html`, `documents/notes/course-none/${DOC}.pdf`]);
    expect(storage.objects.size).toBe(0);
  });

  it('code_execution: figür konteynerden iner (via code_execution), konteyner yeniden üretimde yeniden kullanılır, yerel çalışmaz', async () => {
    const statuses: { status: string; patch: Record<string, unknown> }[] = [];
    const routes: Route[] = [
      [/with target as/, () => [{ id: DOC, kind: 'notes', title: 'Rasyonel sayılar', spec: { topic: 'Rasyonel sayılar', skill_ids: ['tyt.mat.temel.rasyonel-sayilar'], length: 'short' }, status: 'queued', student_id: null, course_id: null, review_required: true, cost_usd: 0, content: null, request_id: DOC, request_status: 'queued', enrollment_id: null, message_id: null }]],
      [/from \(select 1\) one/, () => [{ curriculum_id: CUR, course_title: 'TYT Matematik', target_exam: null, student_ref: null }]],
      [/from public\.skills s/, () => SKILLS as unknown as Record<string, unknown>[]],
      [/document_set_status/, (v) => {
        statuses.push({ status: String(v![1]), patch: JSON.parse(String(v![2])) as Record<string, unknown> });
        return [{ r: { status: v![1] === 'ready' ? 'review' : v![1] } }];
      }],
      // önceki iş denemelerinden kalan kayıtlar (attempts 5): hak bu çalıştırmanın sayısıyla ölçülür
      [/document_block_regen_note/, (v) => [{ r: { attempts: Number(v![4]) + 4, max: 2 } }]],
      [/register_generated_document/, () => [{ id: DOC }]],
      [/from public\.llm_calls/, () => [{ s: 0 }]],
      [/select cost_usd/, () => [{ c: 0 }]],
    ];
    const fileName = figureTasks(buildDraft('notes', NOTES, notesMeta).ast).find((t) => t.kind === 'matplotlib')!.file_name;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="#f6f8fc"/><circle cx="320" cy="120" r="80" fill="#0030a2"/></svg>';
    const transport = new FakeTransport();
    transport.enqueue('notes_generation', { json: NOTES, codeExecution: { command: 'python3 figure.py', files: [{ filename: fileName, content: svg }] } });
    const localRuns: string[] = [];
    documentHooks.figureRun = async (t) => {
      localRuns.push(t.file_name);
      return { ok: false, error: 'yerel çalışmamalı' };
    };
    documentHooks.figuresMode = 'code_execution';
    documentHooks.keyVerifier = verifierFailing(new Set());
    documentHooks.visionCheck = false;
    const storage = new MemoryStorage();
    const ctx = jobCtx({ db: routedDb(routes), storage: () => storage, transport });
    const res = await getJob('document.generate')!.handler!({ document_id: DOC }, ctx);
    expect(res).toMatchObject({ status: 'review', figures: 'code_execution', regen_rounds: 2 });
    expect(localRuns).toEqual([]);
    const ver = statuses.at(-1)!.patch.verification as { figures: Record<string, unknown> };
    expect(ver.figures).toMatchObject({ status: 'pass', mode: 'code_execution', rendered: [{ via: 'code_execution' }] });
    const calls = transport.requests.filter((r) => r.route === 'notes_generation');
    expect(calls).toHaveLength(3);
    expect((calls[0]!.body.tools ?? []).length).toBeGreaterThan(0);
    const container = (c: (typeof calls)[number]) => (typeof c.body.container === 'string' ? c.body.container : (c.body.container as { id?: string } | undefined)?.id);
    expect(container(calls[0]!)).toBeUndefined();
    expect(container(calls[1]!)).toMatch(/^container_fake_/);
    expect(container(calls[2]!)).toBe(container(calls[1]!));
  }, 60_000);

  it('code_execution: dosya inmezse figür yerelde çalıştırılmaz, blok yeniden istenir; inmezse figürsüz', async () => {
    const localRuns: string[] = [];
    const base = await ladderEnv();
    const env = await ladderEnv({
      figures: { ...base.figures, mode: 'code_execution', run: async (t) => (localRuns.push(t.file_name), { ok: true, svg: '<svg/>' }) },
    });
    const r = await runLadder(env, buildDraft('notes', NOTES, notesMeta), { route: 'notes_generation', repaired: false });
    expect(localRuns).toEqual([]);
    expect(env.regenCalls[0]).toEqual([expect.objectContaining({ block_id: 'b4', step: 'figures', reason: expect.stringContaining('konteynerden inmedi') })]);
    expect(r.final.blocks.some((b) => b.id === 'b4')).toBe(false);
  });
});
