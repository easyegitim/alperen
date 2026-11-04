/**
 * Deneme rotaları (P2): page_class, exam_page_items, answer_sheet, inferred_keys, exam_report ve deneme bağlamlı
 * solution_diagnosis. İstek gövdesi (model, düşünme, effort, biçim, yedek, önbellek), sahte fikstürlerin sözleşmeye
 * uyması, eşlemeli fikstür seçimi ve sentetik denemeyle (fixtures/exams/synthetic/exam.json) tutarlılık.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractRegistry, type Contract } from '@ogrenmen/contracts';
import { describe, expect, it } from 'vitest';
import { FALLBACK_BETA } from '../src/client.js';
import { isMatchedFixture, requestText } from '../src/fake.js';
import { MODELS, ROUTES, validateRoute, type RouteName } from '../src/routes.js';
import { COURSE, PRODUCT, setup } from './helpers.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const EXAM = JSON.parse(readFileSync(new URL('../../../fixtures/exams/synthetic/exam.json', import.meta.url), 'utf8')) as SyntheticExam;

interface SyntheticExam {
  booklet_type: string;
  section: string;
  uploads: { order: number; page_class: string; printed_page_number: number | null; question_numbers_seen: number[] }[];
  questions: { no: number; page: number; answer: string; options: string[]; stem?: string; stem_page1?: string; stem_page2?: string; continues_on_page?: number; figure?: { bbox: unknown } }[];
  student_marks: { no: number; marks: string[] }[];
  expected_result: { correct: number[]; wrong: number[]; blank: number[]; double_mark: number[]; net: number };
}

const EXAM_ROUTES = ['page_class', 'exam_page_items', 'answer_sheet', 'inferred_keys', 'exam_report'] as const satisfies readonly RouteName[];

function fixtureFiles(route: string): { file: string; data: unknown }[] {
  return readdirSync(join(FIXTURES, route))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: f, data: JSON.parse(readFileSync(join(FIXTURES, route, f), 'utf8')) as unknown }));
}

function output(data: unknown): unknown {
  return isMatchedFixture(data) ? data.output : data;
}

const pageText = (order: number) => `Yükleme sırası: sayfa ${order}/${EXAM.uploads.length}.\nBu sayfanın türünü belirle.`;
const img = { type: 'image' as const, source: { type: 'file' as const, file_id: 'fake-file-00000001' } };

describe('deneme rota tablosu', () => {
  it('model · effort · düşünme · şema · kip planla aynı', () => {
    expect(ROUTES.page_class).toMatchObject({ model: MODELS.haiku, effort: 'low', thinking: 'off', schema: 'page-class', mode: 'sync', fallbacks: false });
    expect(ROUTES.exam_page_items).toMatchObject({ model: MODELS.sonnet, effort: 'medium', thinking: 'off', schema: 'exam-page-items', mode: 'sync', fallbacks: true });
    expect(ROUTES.answer_sheet).toMatchObject({ model: MODELS.sonnet, effort: 'medium', thinking: 'off', schema: 'answer-sheet', mode: 'sync', fallbacks: true });
    expect(ROUTES.inferred_keys).toMatchObject({ model: MODELS.opus, effort: 'high', thinking: 'adaptive', schema: 'inferred-keys', mode: 'batch', fallbacks: false, tools: ['code_execution'] });
    expect(ROUTES.exam_report).toMatchObject({ model: MODELS.sonnet, effort: 'medium', thinking: 'adaptive', schema: 'exam-report', mode: 'sync', stream: true, progressNote: false });
    for (const r of EXAM_ROUTES) expect(validateRoute(ROUTES[r]), r).toEqual([]);
  });

  it('page_class: Haiku, disabled, yedek yok, ürün bloğu 1 sa önbellekli', () => {
    const { gateway } = setup();
    const body = gateway.buildRequest('page_class', { system: { product: PRODUCT }, user: [img, { type: 'text', text: pageText(1) }] });
    expect(body.model).toBe(MODELS.haiku);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body).not.toHaveProperty('fallbacks');
    expect(body).not.toHaveProperty('betas');
    expect(body.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    expect(body.max_tokens).toBeGreaterThanOrEqual(4000);
    const sys = body.system as { cache_control?: { ttl?: string } }[];
    expect(sys[0]?.cache_control).toMatchObject({ ttl: '1h' });
  });

  it('exam_page_items / answer_sheet: Sonnet between_tools, sunucu yedeği; ders bloğu 1 sa', () => {
    const { gateway } = setup();
    for (const route of ['exam_page_items', 'answer_sheet'] as const) {
      const body = gateway.buildRequest(route, { system: { product: PRODUCT, course: COURSE }, user: [img, { type: 'text', text: pageText(1) }] });
      expect(body.model, route).toBe(MODELS.sonnet);
      expect(body.thinking, route).toEqual({ type: 'between_tools' });
      expect(body.fallbacks, route).toBe('default');
      expect(body.betas, route).toEqual([FALLBACK_BETA]);
      expect(body.output_config, route).toMatchObject({ effort: 'medium', format: { type: 'json_schema' } });
      expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('tools');
    }
  });

  it('inferred_keys: Opus, thinking yok, code_execution; Batch öğesinde yedek yok, batchRetry ile var', () => {
    const { gateway } = setup();
    const input = { system: { product: PRODUCT, course: COURSE }, user: 'sorular' };
    const batch = gateway.buildRequest('inferred_keys', input, { batch: true });
    expect(batch.model).toBe(MODELS.opus);
    expect(batch).not.toHaveProperty('thinking');
    expect(batch).not.toHaveProperty('fallbacks');
    expect(batch.output_config).toMatchObject({ effort: 'high' });
    expect((batch.tools as { name: string }[]).map((t) => t.name)).toEqual(['code_execution']);
    const retry = gateway.buildRequest('inferred_keys', { ...input, batchRetry: true });
    expect(retry.fallbacks).toBe('default');
  });

  it('exam_report: Sonnet adaptive (thinking alanı yok), okuma araçları, ilerleme notu yok', () => {
    const { gateway } = setup();
    const body = gateway.buildRequest('exam_report', { system: { product: PRODUCT, course: COURSE, dossier: 'dossier' }, user: '<exam_result>{}</exam_result>' });
    expect(body.model).toBe(MODELS.sonnet);
    expect(body).not.toHaveProperty('thinking');
    expect(body.fallbacks).toBe('default');
    expect((body.tools as { name: string }[]).map((t) => t.name)).toEqual(['get_mastery', 'get_recent_exams']);
    expect(JSON.stringify(body.system)).not.toContain('kısa bir cümle');
  });
});

describe('deneme fikstürleri', () => {
  it.each(EXAM_ROUTES)('%s: her fikstür rotanın sözleşmesinden geçer', (route) => {
    const contract = contractRegistry[ROUTES[route].schema] as Contract;
    const files = fixtureFiles(route);
    expect(files.length).toBeGreaterThan(0);
    for (const { file, data } of files) {
      const r = contract.safeParse(output(data));
      expect(r.success, `${route}/${file}: ${r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))}`).toBe(true);
    }
  });

  it('deneme bağlamlı teşhis fikstürleri sözleşmeden geçer ve <exam_context> ile eşlenir', () => {
    const files = fixtureFiles('solution_diagnosis').filter((f) => isMatchedFixture(f.data));
    expect(files.map((f) => f.file)).toEqual(['10-deneme-soru-4.json', '11-deneme-soru-9.json']);
    for (const { data } of files) {
      expect(contractRegistry['solution-diagnosis'].isValid(output(data))).toBe(true);
      expect(isMatchedFixture(data) && data.fake_match[0]).toBe('<exam_context>');
    }
  });

  it('sentetik denemeyle tutarlı: 3 sayfa, 10 soru, 10 optik satır, 10 anahtar', () => {
    const pages = fixtureFiles('page_class').filter((f) => isMatchedFixture(f.data)).map((f) => output(f.data) as { page_class: string; printed_page_number: number | null; question_numbers_seen: number[] });
    expect(pages.map((p) => p.page_class)).toEqual(EXAM.uploads.map((u) => u.page_class));
    expect(pages.map((p) => p.printed_page_number)).toEqual(EXAM.uploads.map((u) => u.printed_page_number));
    // Optik formda ve anahtarda question_numbers_seen boş kalır (page_class v1 kuralı); yalnız kitapçıkta basılı numaralar.
    expect(pages.map((p) => p.question_numbers_seen)).toEqual(EXAM.uploads.map((u) => (u.page_class === 'booklet' ? u.question_numbers_seen : [])));

    type Item = { no: number; stem_text: string; options: { key: string; text: string }[]; continues_from_previous: boolean; continues_on_next: boolean; figures: unknown[] };
    const items = fixtureFiles('exam_page_items').filter((f) => isMatchedFixture(f.data)).flatMap((f) => (output(f.data) as { items: Item[] }).items);
    // Sayfalar arası birleştirme: numaraya göre; devam eden sorunun parçaları birleşince kök ve şıklar tamamlanır.
    const merged = new Map<number, Item>();
    for (const it of items) {
      const prev = merged.get(it.no);
      if (!prev) merged.set(it.no, { ...it });
      else {
        expect(prev.continues_on_next && it.continues_from_previous, `soru ${it.no}`).toBe(true);
        merged.set(it.no, { ...prev, stem_text: `${prev.stem_text} ${it.stem_text}`, options: [...prev.options, ...it.options], continues_on_next: it.continues_on_next, figures: [...prev.figures, ...it.figures] });
      }
    }
    expect([...merged.keys()].sort((a, b) => a - b)).toEqual(EXAM.questions.map((q) => q.no));
    for (const q of EXAM.questions) {
      const m = merged.get(q.no);
      expect(m?.options.map((o) => o.text), `soru ${q.no}`).toEqual(q.options);
      expect(m?.stem_text).toBe(q.stem ?? `${q.stem_page1} ${q.stem_page2}`);
      expect(m?.figures.length).toBe(q.figure ? 1 : 0);
    }

    const sheet = output(fixtureFiles('answer_sheet')[0]?.data) as { booklet_type: string; answers: { question_no: number; status: string; marked_option: string | null; marks_seen: string[] }[] };
    expect(sheet.booklet_type).toBe(EXAM.booklet_type);
    expect(sheet.answers.map((a) => [a.question_no, a.marks_seen])).toEqual(EXAM.student_marks.map((m) => [m.no, m.marks]));
    expect(sheet.answers.filter((a) => a.status === 'multiple').map((a) => a.question_no)).toEqual(EXAM.expected_result.double_mark);

    const keys = (output(fixtureFiles('inferred_keys')[0]?.data) as { keys: { question_no: number; correct_option: string | null }[] }).keys;
    expect(keys.map((k) => [k.question_no, k.correct_option])).toEqual(EXAM.questions.map((q) => [q.no, q.answer]));

    // Notlama (TYT: doğru - yanlış/4; çift işaret boş): beklenen sonuçla aynı.
    const key = new Map(keys.map((k) => [k.question_no, k.correct_option]));
    const correct: number[] = [];
    const wrong: number[] = [];
    const blank: number[] = [];
    for (const a of sheet.answers) {
      if (a.status !== 'marked') blank.push(a.question_no);
      else if (a.marked_option === key.get(a.question_no)) correct.push(a.question_no);
      else wrong.push(a.question_no);
    }
    expect({ correct, wrong, blank }).toEqual({ correct: EXAM.expected_result.correct, wrong: EXAM.expected_result.wrong, blank: EXAM.expected_result.blank });
    expect(correct.length - wrong.length / 4).toBe(EXAM.expected_result.net);
  });
});

describe('sahte taşıma: eşlemeli fikstür seçimi', () => {
  it('requestText yalnız metin bloklarını küçük harfle birleştirir', () => {
    expect(requestText({ messages: [{ role: 'user', content: [img, { type: 'text', text: 'Yükleme Sırası: Sayfa 2/3.' }] }] })).toBe('yükleme sırası: sayfa 2/3.');
  });

  it('page_class ve exam_page_items yükleme sırasına göre doğru sayfayı döndürür; eşleşmeyen girdi düz yedeğe düşer', async () => {
    const { gateway } = setup();
    const classes = [];
    for (const u of EXAM.uploads) {
      const r = await gateway.call('page_class', { system: { product: PRODUCT }, user: [img, { type: 'text', text: pageText(u.order) }] });
      classes.push(r.data.page_class);
    }
    expect(classes).toEqual(['booklet', 'booklet', 'answer_sheet']);
    const p2 = await gateway.call('exam_page_items', { system: { product: PRODUCT, course: COURSE }, user: [img, { type: 'text', text: pageText(2) }] });
    expect(p2.data.items.map((i) => i.no)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(p2.data.items[0]?.continues_from_previous).toBe(true);
    const other = await gateway.call('page_class', { system: { product: PRODUCT }, user: [img, { type: 'text', text: 'Yükleme sırası: sayfa 1/1.' }] });
    expect(contractRegistry['page-class'].isValid(other.data)).toBe(true);
    expect(other.data.page_class).toBe('booklet');
  });

  it('answer_sheet senkron, inferred_keys Batch (ve batchRetry ile senkron), exam_report akışlı uçtan uca', async () => {
    const { gateway, ledger } = setup();
    const sheet = await gateway.call('answer_sheet', { system: { product: PRODUCT }, user: [img, { type: 'text', text: pageText(3) }] });
    expect(sheet.data.answers).toHaveLength(10);

    const { batch, meta } = await gateway.submitBatch('inferred_keys', [{ customId: 'exam_1', input: { system: { product: PRODUCT, course: COURSE }, user: 'sorular' } }]);
    await gateway.pollBatch(batch.id, { sleep: async () => undefined });
    const [res] = await gateway.collectBatch('inferred_keys', batch.id, meta);
    expect(res?.status).toBe('ok');
    expect((res?.data as { keys: unknown[] }).keys).toHaveLength(10);
    const sync = await gateway.call('inferred_keys', { system: { product: PRODUCT, course: COURSE }, user: 'sorular', batchRetry: true });
    expect(sync.data.keys).toHaveLength(10);

    const report = await gateway.call('exam_report', { system: { product: PRODUCT, course: COURSE }, user: '<exam_result>{}</exam_result>' });
    expect(report.data.kind).toBe('report');
    expect(report.data.keys).toEqual([]);
    expect(ledger.rows.every((r) => r.status === 'ok')).toBe(true);
  });

  it('deneme bağlamlı teşhis soru numarasına göre seçilir; bağlamsız teşhis düz fikstürü alır', async () => {
    const { gateway } = setup();
    const ctx = (no: number) => `<exam_context>\nDeneme: Örnek Deneme 1\nSoru no: ${no}.\nBölüm: Matematik\n</exam_context>`;
    const q4 = await gateway.call('solution_diagnosis', { system: { product: PRODUCT, course: COURSE }, user: [img, { type: 'text', text: ctx(4) }] });
    expect(q4.data.skill_ids).toEqual(['tyt.mat.temel.uslu']);
    const q9 = await gateway.call('solution_diagnosis', { system: { product: PRODUCT, course: COURSE }, user: [img, { type: 'text', text: ctx(9) }] });
    expect(q9.data.skill_ids).toEqual(['tyt.mat.temel.ondalik']);
    const plain = await gateway.call('solution_diagnosis', { system: { product: PRODUCT, course: COURSE }, user: [img, { type: 'text', text: 'Çözümüm' }] });
    expect(plain.data.misconception_tags).toEqual(['sayilar.parantez-eksi-dagitma']);
  });
});
