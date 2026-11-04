/**
 * İçerik stüdyosu rotaları (P3, PLAN-v2 §5/§7): notes_generation, exam_generation, figure_check,
 * personalization_check, style_question_gen. İstek gövdesi (Opus'ta thinking yok, effort, akış, araç listesi,
 * önbellek sırası), code_execution konteyner yeniden kullanımı, yerel figür kipi (araçsız), Files API indirme
 * yardımcıları ve sahte fikstürlerin sözleşmeye/tutarlılığa uyması.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calloutReferenceIssues,
  contractRegistry,
  documentFigureJobs,
  examFigureJobs,
  type Contract,
  type DocumentAst,
  type ExamGeneration,
} from '@ogrenmen/contracts';
import { describe, expect, it } from 'vitest';
import { FALLBACK_BETA } from '../src/client.js';
import { collectOutputFiles, downloadFigureFiles, downloadOutputFiles, safeFileName, type FilesClient } from '../src/files.js';
import { collectBreakpoints } from '../src/prompt.js';
import { MODELS, ROUTES, validateRoute, type RouteName } from '../src/routes.js';
import { COURSE, DOSSIER, PRODUCT, setup } from './helpers.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const CONTENT_ROUTES = ['notes_generation', 'exam_generation', 'figure_check', 'personalization_check', 'style_question_gen'] as const satisfies readonly RouteName[];

function fixture<T>(route: string, file: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, route, file), 'utf8')) as T;
}

const SYSTEM = { product: PRODUCT, course: COURSE, dossier: DOSSIER };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200"><rect width="640" height="200" fill="#f6f8fc"/></svg>';

describe('içerik rota tablosu', () => {
  it('model · effort · düşünme · şema · araç · kip planla aynı', () => {
    for (const r of ['notes_generation', 'exam_generation'] as const) {
      expect(ROUTES[r], r).toMatchObject({ model: MODELS.opus, effort: 'high', thinking: 'adaptive', tools: ['code_execution'], mode: 'sync', stream: true, batchable: true, fallbacks: true, progressNote: false });
      expect(ROUTES[r].cache, r).toEqual({ productTtl: '1h', courseTtl: '1h', dossierTtl: '5m', tail: false });
    }
    expect(ROUTES.notes_generation.schema).toBe('document-ast');
    expect(ROUTES.exam_generation.schema).toBe('exam-generation');
    expect(ROUTES.figure_check).toMatchObject({ model: MODELS.haiku, effort: 'low', thinking: 'off', schema: 'figure-render-report', tools: [], fallbacks: false });
    expect(ROUTES.personalization_check).toMatchObject({ model: MODELS.haiku, effort: 'low', thinking: 'off', schema: 'personalization-check', tools: [], fallbacks: false, stream: false });
    expect(ROUTES.style_question_gen).toMatchObject({ model: MODELS.opus, effort: 'high', schema: 'style-question-generation', tools: ['code_execution'] });
    for (const r of CONTENT_ROUTES) expect(validateRoute(ROUTES[r]), r).toEqual([]);
  });
});

describe('istek gövdesi', () => {
  it('notes_generation / exam_generation: Opus, thinking yok, effort high, biçim, code_execution_20260120, yedek, örnekleme yok', () => {
    const { gateway } = setup();
    for (const route of ['notes_generation', 'exam_generation'] as const) {
      const body = gateway.buildRequest(route, { system: SYSTEM, user: '<note_request>{}</note_request>', turn: { date: '2026-11-04' } });
      expect(body.model, route).toBe(MODELS.opus);
      expect(body, route).not.toHaveProperty('thinking');
      expect(body.output_config, route).toMatchObject({ effort: 'high', format: { type: 'json_schema' } });
      expect(body.tools, route).toEqual([{ type: 'code_execution_20260120', name: 'code_execution' }]);
      expect(body.fallbacks, route).toBe('default');
      expect(body.betas, route).toEqual([FALLBACK_BETA]);
      expect(body.max_tokens, route).toBe(64000);
      for (const k of ['temperature', 'top_p', 'top_k', 'tool_choice', 'container']) expect(body, `${route}.${k}`).not.toHaveProperty(k);
      // sunucu aracına eager_input_streaming eklenmez
      expect(JSON.stringify(body.tools)).not.toContain('eager_input_streaming');
    }
  });

  it('önbellek sırası: araçlar → system[0] ürün 1 sa → system[1] ders 1 sa → system[2] dossier 5 dk; tur sistem mesajı sonda', () => {
    const { gateway } = setup();
    const body = gateway.buildRequest('notes_generation', { system: SYSTEM, user: 'istek', turn: { date: '2026-11-04' } });
    const sys = body.system as { text: string; cache_control?: { type: string; ttl?: string } }[];
    expect(sys.map((b) => b.cache_control?.ttl ?? '5m')).toEqual(['1h', '1h', '5m']);
    expect(sys[0]?.text.startsWith(PRODUCT)).toBe(true);
    expect(sys[1]?.text).toBe(COURSE);
    expect(sys[2]?.text).toBe(DOSSIER);
    expect(body).not.toHaveProperty('cache_control');
    expect(collectBreakpoints(body)).toHaveLength(3);
    const last = body.messages.at(-1) as { role: string; content: unknown };
    expect(last.role).toBe('system');
    expect(JSON.stringify(last.content)).toContain('2026-11-04');
    // akışlı, biçimli, sunucu araçlı: ilerleme notu eklenmez (biçimle çatışmasın)
    expect(sys[0]?.text).toBe(PRODUCT);
  });

  it('yerel figür kipi: disableTools code_execution → araç ve container gönderilmez, prompt aynı', () => {
    const { gateway } = setup();
    const withTool = gateway.buildRequest('notes_generation', { system: SYSTEM, user: 'istek', container: 'container_abc' });
    const local = gateway.buildRequest('notes_generation', { system: SYSTEM, user: 'istek', container: 'container_abc', disableTools: ['code_execution'] });
    expect(withTool.container).toBe('container_abc');
    expect(local).not.toHaveProperty('tools');
    expect(local).not.toHaveProperty('container');
    expect(local.system).toEqual(withTool.system);
    expect(() => gateway.buildRequest('figure_check', { system: SYSTEM, user: 'x', disableTools: ['code_execution'] })).toThrow(/rotada yok/);
  });

  it('figure_check / personalization_check: Haiku disabled, yedek yok, ürün bloğu 1 sa; görsel bloğu geçer', () => {
    const { gateway } = setup();
    const img = { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'iVBORw0KGgo=' } };
    for (const route of ['figure_check', 'personalization_check'] as const) {
      const body = gateway.buildRequest(route, { system: { product: PRODUCT }, user: [img, { type: 'text', text: 'denetle' }] });
      expect(body.model, route).toBe(MODELS.haiku);
      expect(body.thinking, route).toEqual({ type: 'disabled' });
      expect(body, route).not.toHaveProperty('fallbacks');
      expect(body, route).not.toHaveProperty('tools');
      expect(body.output_config, route).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
      expect((body.system as { cache_control?: { ttl?: string } }[])[0]?.cache_control).toMatchObject({ ttl: '1h' });
    }
  });

  it('Batch öğesi: yedek yok, code_execution var, container korunur', () => {
    const { gateway } = setup();
    const b = gateway.buildRequest('exam_generation', { system: SYSTEM, user: 'istek', container: 'container_job1' }, { batch: true });
    expect(b).not.toHaveProperty('fallbacks');
    expect(b.container).toBe('container_job1');
    expect((b.tools as { name: string }[]).map((t) => t.name)).toEqual(['code_execution']);
  });
});

describe('code_execution: konteyner ve çıktı dosyaları (sahte taşıma)', () => {
  it('pause_turn sürdürmesi ve sonraki çağrı aynı konteyneri kullanır; figür dosyaları Files API ile iner', async () => {
    const { gateway, fake } = setup();
    const notes = fixture<DocumentAst>('notes_generation', '01-rasyonel.json');
    fake.enqueue(
      'notes_generation',
      { codeExecution: { command: 'python3 figure_1.py', files: [{ filename: 'figure_1.svg', content: '<svg>eski</svg>' }] }, stopReason: 'pause_turn' },
      { codeExecution: { files: [{ filename: 'figure_1.svg', content: SVG }, { filename: '../notlar.txt', content: 'x' }] }, json: notes },
    );
    const res = await gateway.call('notes_generation', { system: SYSTEM, user: 'istek' });
    expect(res.data.kind).toBe('notes');
    expect(res.container).toMatch(/^container_fake_/);
    // İkinci istek (pause_turn sürdürmesi) ilk yanıtın konteynerini taşır.
    const reqs = fake.requests.filter((r) => r.route === 'notes_generation');
    expect(reqs).toHaveLength(2);
    expect(reqs[0]?.body).not.toHaveProperty('container');
    expect(reqs[1]?.body.container).toBe(res.container);

    const refs = collectOutputFiles(res.transcript);
    expect(refs).toHaveLength(3);
    const { svgs, skipped } = await downloadFigureFiles(fake.files, refs);
    expect(svgs).toEqual({ 'figure_1.svg': SVG }); // aynı ad: son üretilen
    expect(skipped).toEqual([expect.objectContaining({ filename: 'notlar.txt', reason: 'pattern' })]);
    // indirilen ve atlanan dosyalar Files API'den silindi
    expect(fake.storedFileCount).toBe(0);
    // figür işi ↔ indirilen dosya adı
    expect(documentFigureJobs(res.data).map((j) => j.file_name)).toEqual(['figure_1.svg']);

    // Aynı iş içinde sonraki çağrı (ör. tek bloğun yeniden üretimi) konteyneri yeniden kullanır.
    const again = await gateway.call('exam_generation', { system: SYSTEM, user: 'istek', container: res.container });
    expect(fake.requests.at(-1)?.body.container).toBe(res.container);
    expect(again.container).toBe(res.container);
  });

  it('yerel kipte konteyner yok', async () => {
    const { gateway, fake } = setup();
    const res = await gateway.call('exam_generation', { system: SYSTEM, user: 'istek', disableTools: ['code_execution'] });
    expect(res.container).toBeNull();
    expect(fake.requests.at(-1)?.body).not.toHaveProperty('tools');
    expect(examFigureJobs(res.data).map((j) => [j.question_no, j.kind])).toEqual([
      [8, 'matplotlib'],
      [9, 'svg'],
    ]);
  });

  it('safeFileName ve boyut sınırı', async () => {
    expect(safeFileName('/tmp/out/figure_2.svg')).toBe('figure_2.svg');
    expect(safeFileName('..')).toBeNull();
    expect(safeFileName('a\\..\\figure_3.svg')).toBe('figure_3.svg');
    const files: FilesClient = {
      retrieveMetadata: async (id) => ({ id, filename: 'figure_1.svg', mime_type: 'image/svg+xml', size_bytes: 10 }),
      download: async () => ({ arrayBuffer: async () => new Uint8Array(20).buffer }),
    };
    const r = await downloadOutputFiles(files, [{ fileId: 'f1', toolUseId: 't', source: 'bash' }], { maxBytes: 12 });
    expect(r.files).toEqual([]);
    expect(r.skipped).toEqual([{ fileId: 'f1', filename: 'figure_1.svg', reason: 'size' }]);
    const broken: FilesClient = { retrieveMetadata: async () => Promise.reject(new Error('404')), download: files.download };
    expect((await downloadOutputFiles(broken, [{ fileId: 'f2', toolUseId: 't', source: 'bash' }])).skipped[0]?.reason).toBe('error');
  });

  it('eski code_execution_tool_result biçimi de toplanır', () => {
    const refs = collectOutputFiles([
      { type: 'code_execution_tool_result', tool_use_id: 'srv_1', content: { type: 'code_execution_result', stdout: '', stderr: '', return_code: 0, content: [{ type: 'code_execution_output', file_id: 'file_a' }] } },
      { type: 'bash_code_execution_tool_result', tool_use_id: 'srv_2', content: { type: 'bash_code_execution_tool_result_error', error_code: 'unavailable' } },
    ]);
    expect(refs).toEqual([{ fileId: 'file_a', toolUseId: 'srv_1', source: 'python' }]);
  });
});

describe('içerik fikstürleri', () => {
  it.each(CONTENT_ROUTES.filter((r) => r !== 'style_question_gen'))('%s: her fikstür sözleşmeden geçer', (route) => {
    const contract = contractRegistry[ROUTES[route].schema] as Contract;
    const files = readdirSync(join(FIXTURES, route)).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const r = contract.safeParse(fixture(route, f));
      expect(r.success, `${route}/${f}: ${r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))}`).toBe(true);
    }
  });

  it('notes_generation/01-rasyonel: 8 içerik bloğu, 1 figür kodu, 1 kaynaklı hata kutusu, 3 soru + anahtar, cevap sayfası sonda', () => {
    const doc = fixture<DocumentAst>('notes_generation', '01-rasyonel.json');
    const questions = doc.blocks.filter((b) => b.type === 'question');
    expect(doc.blocks.length - questions.length).toBe(8);
    expect(questions).toHaveLength(3);
    expect(doc.keys.map((k) => k.question_no)).toEqual([1, 2, 3]);
    expect(doc.keys.every((k) => k.canonical_expr !== null)).toBe(true);
    expect(documentFigureJobs(doc)).toHaveLength(1);
    expect(documentFigureJobs(doc)[0]?.code).toContain('save_figure(fig, 1)');
    const callouts = doc.blocks.filter((b) => b.type === 'common_mistake_callout');
    expect(callouts).toHaveLength(1);
    expect(calloutReferenceIssues(doc, [{ source: 'patterns.md', id: 'patterns.md:2', dates: ['2026-10-12', '2026-10-19'] }])).toEqual([]);
    expect(doc.blocks.at(-1)?.type).toBe('answer_key_page');
    expect(doc.meta.personalized).toBe(true);
  });

  it('exam_generation/01-tyt10: 10 soru, 2 kodlu figür, dağılım ve anahtar tutarlı', () => {
    const exam = contractRegistry['exam-generation'].parse(fixture('exam_generation', '01-tyt10.json')) as ExamGeneration;
    expect(exam.items).toHaveLength(10);
    expect(exam.keys).toHaveLength(10);
    expect(exam.items.filter((i) => i.figure).length).toBe(2);
    expect(exam.items.every((i) => i.figure_svg === null)).toBe(true);
    expect(exam.blueprint?.sections.reduce((s, x) => s + x.count, 0)).toBe(10);
    expect(exam.keys.map((k) => k.correct_option).join('')).toBe('BDAECBDACE');
    expect(exam.keys.every((k) => k.canonical_expr !== null)).toBe(true);
  });

  it('sahte taşıma: rotanın varsayılan yanıtı fikstürdür', async () => {
    const { gateway } = setup();
    const n = await gateway.call('notes_generation', { system: SYSTEM, user: 'istek', disableTools: ['code_execution'] });
    expect(n.data.title).toBe('Rasyonel sayılar notu');
    const e = await gateway.call('exam_generation', { system: SYSTEM, user: 'istek', disableTools: ['code_execution'] });
    expect(e.data.items).toHaveLength(10);
    const p = await gateway.call('personalization_check', { system: { product: PRODUCT }, user: 'kutular' });
    expect(p.data).toEqual({ ok: true, offending_block_ids: [], findings: [] });
    const f = await gateway.call('figure_check', { system: { product: PRODUCT }, user: 'şekil' });
    expect(f.data.matches_stem).toBe(true);
  });
});
