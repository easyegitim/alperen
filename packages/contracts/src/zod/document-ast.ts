/**
 * document-ast — tipli, özyinelemesiz belge ağacı (PLAN-v2 §7, PLAN-v2-detail §4). Not, deneme, rapor ve
 * soru seti bu yapıdan üretilir; `packages/doc-render` render eder. Cevap anahtarı `keys[]`'te ayrıdır
 * (renderer öğrenciye göstermez).
 *
 * SAKLAMA: model çıktısı `keys[]` taşır, ama `generated_documents.content` öğrencinin RLS ile okuyabildiği bir
 * sütundur. Worker parse sonrası `splitDocumentKeys(doc)` çağırır: `keys` -> `secure.exam_answer_keys`,
 * `content` (keys boş) -> `generated_documents.content`. Saklanan biçim `storedDocumentAst` ile doğrulanır.
 *
 * Plan listesine eklenenler: her blokta `id` (hata durumunda yalnız o bloğun yeniden üretilmesi için) ve
 * rapor belgeleri için `chart` bloğu (veri `data_ref` ile render anında deterministik doldurulur).
 */
import { z } from 'zod';
import { OPTION_KEYS_5, exactlyOneKeyValue, keyEntryShape, optionKey5, skillCode } from './common.js';
import { type Ctx, addIssue, defineContract, looseCtx } from './kit.js';

export const DOCUMENT_KINDS = ['notes', 'mock_exam', 'report', 'question_set'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const BLOCK_TYPES = [
  'heading',
  'paragraph',
  'math_display',
  'definition_box',
  'summary_box',
  'worked_example',
  'common_mistake_callout',
  'check_yourself',
  'figure',
  'table',
  'question',
  'answer_sheet',
  'answer_key_page',
  'page_break',
  'chart',
] as const;

export const CHART_KINDS = [
  'score_by_section',
  'skill_heatmap',
  'mastery_trend',
  'time_per_question',
  'error_cause_histogram',
  'style_coverage',
] as const;

/**
 * Şekil yükü: `source` hangisinin dolu olduğunu söyler (svg | upload_id). Rapor kipinde yalnız `svg` vardır:
 * veli ham `uploads` kayıtlarını görmez (PLAN-v2 §2.4).
 */
const figureFields = (c: Ctx, text: Ctx['str'], reportMode: boolean) => {
  const alt = text({ min: 5, max: 400, desc: 'Şekli kelimelerle anlatır' });
  const svg = c.str({ max: 60000, desc: 'source=svg ise satır içi SVG' }).optional();
  const full = { source: z.enum(['svg', 'upload']), svg, upload_id: c.uuid('source=upload ise uploads.id').optional(), alt };
  // Tür sabit kalsın (refine kuralları tam biçimle yazılır); rapor kipinde `upload` kaynağı ve `upload_id` alanı yoktur.
  return (reportMode ? { source: z.enum(['svg']), svg, alt } : full) as unknown as typeof full;
};

/** Rapor kipinde (kinds yalnız ['report']) veliye gidemeyen blok türleri: soru gövdesi ve cevap kâğıdı/anahtar sayfası. */
const REPORT_FORBIDDEN_BLOCKS: readonly string[] = ['question', 'answer_sheet', 'answer_key_page'];

export function makeDocumentAst(c: Ctx, kinds: readonly [DocumentKind, ...DocumentKind[]], opts: { storedKeys?: boolean } = {}) {
  // Rapor kipi: yalnız `report`. Veli okur; soru gövdesi, cevap anahtarı ve ham yükleme taşınamaz (şema düzeyinde).
  const reportMode = kinds.every((k) => k === 'report');
  // Matematik içermeyen (rapor) belgelerde veliye görünen bütün metinlerde ünlem ve emoji yasak; notlarda '!' (faktöriyel) olabilir.
  const prose = (o: Parameters<Ctx['str']>[0]) => (reportMode ? c.uiText(o) : c.str(o));
  const base = { id: c.str({ min: 1, max: 40, desc: 'Belge içinde tekil blok kimliği' }), section_no: c.int({ min: 0, max: 60 }) };
  const block = <K extends (typeof BLOCK_TYPES)[number], S extends z.ZodRawShape>(type: K, shape: S) =>
    z.strictObject({ type: z.literal(type), ...base, ...shape });

  const allBlocks = [
    block('heading', { level: c.int({ min: 1, max: 3 }), text: prose({ min: 1, max: 200 }) }),
    block('paragraph', { text: prose({ min: 1, max: 3000, desc: 'Satır içi matematik $...$ ile' }) }),
    block('math_display', { latex: c.str({ min: 1, max: 1000 }) }),
    block('definition_box', { term: prose({ min: 1, max: 120 }), body: prose({ min: 1, max: 1500 }) }),
    block('summary_box', { title: prose({ min: 1, max: 120 }), bullets: c.arr(prose({ min: 1, max: 400 }), { min: 1, max: 12 }) }),
    block('worked_example', {
      title: prose({ min: 1, max: 160 }),
      problem: prose({ min: 1, max: 1500 }),
      steps: c.arr(prose({ min: 1, max: 600 }), { min: 1, max: 15 }),
      answer: prose({ min: 1, max: 300 }),
    }),
    block('common_mistake_callout', {
      pattern_id: c.str({ min: 1, max: 120, desc: 'Gerçek bir örüntüye başvuru: yanılgı etiketi ya da patterns.md girdisi' }),
      text: c.uiText({ min: 1, max: 800 }),
    }),
    block('check_yourself', { question: prose({ min: 1, max: 800 }), answer_hidden: prose({ min: 1, max: 800 }) }),
    block('figure', figureFields(c, prose, reportMode)),
    block('table', {
      caption: prose({ max: 200 }).optional(),
      header: c.arr(prose({ max: 120 }), { max: 12 }),
      rows: c.arr(c.arr(prose({ max: 200 }), { max: 12 }), { min: 1, max: 60 }),
    }),
    block('question', {
      no: c.int({ min: 1, max: 500 }),
      stem: c.str({ min: 1, max: 2500 }),
      options: c.arr(z.strictObject({ key: optionKey5, text: c.str({ min: 1, max: 600 }) }), { max: 5 }),
      figure: z.strictObject(figureFields(c, prose, reportMode)).optional(),
      skill_ids: c.arr(skillCode(c), { max: 3 }),
      style_id: c.uuid('question_styles.id').optional(),
    }),
    block('answer_sheet', { title: c.str({ max: 120 }), question_count: c.int({ min: 1, max: 500 }), options_per_question: c.int({ min: 2, max: 5 }) }),
    block('answer_key_page', { title: c.str({ max: 120 }) }),
    block('page_break', {}),
    block('chart', {
      chart_kind: z.enum(CHART_KINDS),
      title: prose({ min: 1, max: 160 }),
      data_ref: c.str({ min: 1, max: 120, desc: 'Render anında deterministik doldurulan veri kaynağı adı' }),
      caption: prose({ max: 300 }).optional(),
    }),
  ] as const;
  const blockOptions = (reportMode ? allBlocks.filter((b) => !REPORT_FORBIDDEN_BLOCKS.includes(b.shape.type.value)) : allBlocks) as unknown as typeof allBlocks;
  const blocks = c.variants('type', blockOptions);

  const keyRows = c.arr(z.strictObject(keyEntryShape(c)), { max: 500 });
  // Saklanan belgede ve raporda `keys` boş olmalı (rapor cevap anahtarı taşımaz). `not: {}` strict dilbilgisinde yok; model kipinde
  // dizi serbest bırakılır, loose doğrulama boş olmayanı reddeder.
  const keysSchema = opts.storedKeys
    ? z.array(z.never()).describe('Saklanan belgede boş: anahtar secure.exam_answer_keys içindedir')
    : reportMode
      ? ((c.isLoose ? z.array(z.never()).describe('Raporda boş: rapor cevap anahtarı taşımaz') : keyRows) as unknown as typeof keyRows)
      : keyRows;

  return z.strictObject({
    kind: z.enum(kinds),
    title: prose({ min: 1, max: 200 }),
    meta: z.strictObject({
      course_title: prose({ min: 1, max: 160 }),
      subtitle: prose({ max: 200 }).nullable(),
      generated_on: c.date(),
      language: z.literal('tr'),
      personalized: z.boolean().describe('Belge öğrencinin dossier verisiyle kişiselleştirildi mi'),
      duration_min: c.int({ min: 1, max: 600 }).nullable(),
    }),
    sections: c.arr(z.strictObject({ no: c.int({ min: 0, max: 60 }), title: prose({ min: 1, max: 160 }) }), { max: 60 }),
    blocks: c.arr(blocks, { min: 1, max: 600 }),
    keys: keysSchema,
  });
}

export type DocumentAstShape = z.output<ReturnType<typeof makeDocumentAst>>;

/** Çapraz kurallar: blok/bölüm tutarlılığı, şekil yükü, soru ↔ anahtar eşlemesi. */
export function refineDocumentAst(v: DocumentAstShape, ctx: z.RefinementCtx): void {
  const questionNos = refineDocumentStructure(v, ctx);
  refineDocumentKeys(v, ctx, questionNos);
}

/** Anahtardan bağımsız yapı kuralları; soru numaralarını döndürür. */
function refineDocumentStructure(v: Pick<DocumentAstShape, 'sections' | 'blocks'>, ctx: z.RefinementCtx): Set<number> {
  const sectionNos = new Set<number>();
  v.sections.forEach((s, i) => {
    if (sectionNos.has(s.no)) addIssue(ctx, ['sections', i, 'no'], `yinelenen bölüm numarası: ${s.no}`);
    sectionNos.add(s.no);
  });
  const ids = new Set<string>();
  const questionNos = new Set<number>();
  const checkFigure = (f: { source: string; svg?: string | undefined; upload_id?: string | undefined }, path: (string | number)[]) => {
    if (f.source === 'svg' && (f.svg === undefined || f.upload_id !== undefined)) addIssue(ctx, path, 'source=svg için yalnız svg dolu olmalı');
    if (f.source === 'upload' && (f.upload_id === undefined || f.svg !== undefined)) addIssue(ctx, path, 'source=upload için yalnız upload_id dolu olmalı');
  };
  v.blocks.forEach((b, i) => {
    if (ids.has(b.id)) addIssue(ctx, ['blocks', i, 'id'], `yinelenen blok kimliği: ${b.id}`);
    ids.add(b.id);
    if (v.sections.length > 0 && !sectionNos.has(b.section_no)) addIssue(ctx, ['blocks', i, 'section_no'], `bilinmeyen bölüm: ${b.section_no}`);
    if (b.type === 'figure') checkFigure(b, ['blocks', i]);
    if (b.type === 'question') {
      if (questionNos.has(b.no)) addIssue(ctx, ['blocks', i, 'no'], `yinelenen soru numarası: ${b.no}`);
      questionNos.add(b.no);
      if (b.figure) checkFigure(b.figure, ['blocks', i, 'figure']);
      const keys = b.options.map((o) => o.key);
      if (new Set(keys).size !== keys.length) addIssue(ctx, ['blocks', i, 'options'], 'şık anahtarları tekil olmalı');
      keys.forEach((k, j) => {
        if (k !== OPTION_KEYS_5[j]) addIssue(ctx, ['blocks', i, 'options', j, 'key'], 'şık anahtarları A, B, C, D, E sırasında olmalı');
      });
    }
  });
  return questionNos;
}

function refineDocumentKeys(v: DocumentAstShape, ctx: z.RefinementCtx, questionNos: Set<number>): void {
  const keyNos = new Set<number>();
  v.keys.forEach((k, i) => {
    if (keyNos.has(k.question_no)) addIssue(ctx, ['keys', i, 'question_no'], `yinelenen anahtar: ${k.question_no}`);
    keyNos.add(k.question_no);
    if (!exactlyOneKeyValue(k)) addIssue(ctx, ['keys', i], 'correct_option ile numeric_value\'dan tam biri dolu olmalı');
    if (!questionNos.has(k.question_no)) addIssue(ctx, ['keys', i, 'question_no'], `anahtarın sorusu yok: ${k.question_no}`);
  });
  for (const no of questionNos) {
    if (!keyNos.has(no)) addIssue(ctx, ['keys'], `soru ${no} için anahtar yok`);
  }
  v.blocks.forEach((b, i) => {
    if (b.type !== 'question') return;
    const key = v.keys.find((k) => k.question_no === b.no);
    if (key?.correct_option && b.options.length > 0 && !b.options.some((o) => o.key === key.correct_option)) {
      addIssue(ctx, ['keys'], `soru ${b.no} için doğru şık seçeneklerde yok`);
    }
    if (key?.correct_option && b.options.length === 0) addIssue(ctx, ['blocks', i, 'options'], 'şık anahtarı olan sorunun şıkları olmalı');
  });
}

export const documentAst = defineContract({
  name: 'document-ast',
  title: 'DocumentAst',
  description:
    'Belge ağacı (not, deneme, rapor, soru seti): bölümler, tipli bloklar ve ayrı cevap anahtarı. Özyinelemesiz; her blok section_no taşır.',
  llmOutput: true,
  build: (c) => makeDocumentAst(c, DOCUMENT_KINDS),
  refine: (v, ctx) => refineDocumentAst(v as DocumentAstShape, ctx),
});

export type DocumentAst = z.output<typeof documentAst.strict>;
export type DocumentBlock = DocumentAst['blocks'][number];
export type DocumentKey = DocumentAst['keys'][number];

/** Saklanan belge: `keys` boş. `generated_documents.content` bu biçimi taşır (öğrenci okuyabilir; anahtar yok). */
export const storedDocumentAst = makeDocumentAst(looseCtx, DOCUMENT_KINDS, { storedKeys: true }).superRefine((v, ctx) =>
  void refineDocumentStructure(v as unknown as Pick<DocumentAstShape, 'sections' | 'blocks'>, ctx),
);
export type StoredDocumentAst = z.output<typeof storedDocumentAst>;

/**
 * Model çıktısını saklama biçimine ayırır: anahtarlar `keys` olarak (secure.exam_answer_keys'e yazılacak),
 * belge `content` olarak (keys = []). Girdiyi değiştirmez.
 */
export function splitDocumentKeys<T extends { keys: readonly unknown[] }>(doc: T): { content: Omit<T, 'keys'> & { keys: [] }; keys: T['keys'] } {
  const { keys, ...rest } = doc;
  return { content: { ...rest, keys: [] }, keys };
}
