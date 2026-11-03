/**
 * document-ast — tipli, özyinelemesiz belge ağacı (PLAN-v2 §7, PLAN-v2-detail §4). Not, deneme, rapor ve
 * soru seti bu yapıdan üretilir; `packages/doc-render` render eder. Cevap anahtarı `keys[]`'te ayrıdır
 * (renderer öğrenciye göstermez).
 *
 * Plan listesine eklenenler: her blokta `id` (hata durumunda yalnız o bloğun yeniden üretilmesi için) ve
 * rapor belgeleri için `chart` bloğu (veri `data_ref` ile render anında deterministik doldurulur).
 */
import { z } from 'zod';
import { OPTION_KEYS_5, exactlyOneKeyValue, keyEntryShape, optionKey5, skillCode } from './common.js';
import { type Ctx, addIssue, defineContract } from './kit.js';

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

/** Şekil yükü: `source` hangisinin dolu olduğunu söyler (svg | upload_id). */
const figureFields = (c: Ctx) => ({
  source: z.enum(['svg', 'upload']),
  svg: c.str({ max: 60000, desc: 'source=svg ise satır içi SVG' }).optional(),
  upload_id: c.uuid('source=upload ise uploads.id').optional(),
  alt: c.str({ min: 5, max: 400, desc: 'Şekli kelimelerle anlatır' }),
});

export function makeDocumentAst(c: Ctx, kinds: readonly [DocumentKind, ...DocumentKind[]]) {
  const base = { id: c.str({ min: 1, max: 40, desc: 'Belge içinde tekil blok kimliği' }), section_no: c.int({ min: 0, max: 60 }) };
  const block = <K extends (typeof BLOCK_TYPES)[number], S extends z.ZodRawShape>(type: K, shape: S) =>
    z.strictObject({ type: z.literal(type), ...base, ...shape });

  const blocks = c.variants('type', [
    block('heading', { level: c.int({ min: 1, max: 3 }), text: c.str({ min: 1, max: 200 }) }),
    block('paragraph', { text: c.str({ min: 1, max: 3000, desc: 'Satır içi matematik $...$ ile' }) }),
    block('math_display', { latex: c.str({ min: 1, max: 1000 }) }),
    block('definition_box', { term: c.str({ min: 1, max: 120 }), body: c.str({ min: 1, max: 1500 }) }),
    block('summary_box', { title: c.str({ min: 1, max: 120 }), bullets: c.arr(c.str({ min: 1, max: 400 }), { min: 1, max: 12 }) }),
    block('worked_example', {
      title: c.str({ min: 1, max: 160 }),
      problem: c.str({ min: 1, max: 1500 }),
      steps: c.arr(c.str({ min: 1, max: 600 }), { min: 1, max: 15 }),
      answer: c.str({ min: 1, max: 300 }),
    }),
    block('common_mistake_callout', {
      pattern_id: c.str({ min: 1, max: 120, desc: 'Gerçek bir örüntüye başvuru: yanılgı etiketi ya da patterns.md girdisi' }),
      text: c.str({ min: 1, max: 800 }),
    }),
    block('check_yourself', { question: c.str({ min: 1, max: 800 }), answer_hidden: c.str({ min: 1, max: 800 }) }),
    block('figure', figureFields(c)),
    block('table', {
      caption: c.str({ max: 200 }).optional(),
      header: c.arr(c.str({ max: 120 }), { max: 12 }),
      rows: c.arr(c.arr(c.str({ max: 200 }), { max: 12 }), { min: 1, max: 60 }),
    }),
    block('question', {
      no: c.int({ min: 1, max: 500 }),
      stem: c.str({ min: 1, max: 2500 }),
      options: c.arr(z.strictObject({ key: optionKey5, text: c.str({ min: 1, max: 600 }) }), { max: 5 }),
      figure: z.strictObject(figureFields(c)).optional(),
      skill_ids: c.arr(skillCode(c), { max: 3 }),
      style_id: c.uuid('question_styles.id').optional(),
    }),
    block('answer_sheet', { title: c.str({ max: 120 }), question_count: c.int({ min: 1, max: 500 }), options_per_question: c.int({ min: 2, max: 5 }) }),
    block('answer_key_page', { title: c.str({ max: 120 }) }),
    block('page_break', {}),
    block('chart', {
      chart_kind: z.enum(CHART_KINDS),
      title: c.str({ min: 1, max: 160 }),
      data_ref: c.str({ min: 1, max: 120, desc: 'Render anında deterministik doldurulan veri kaynağı adı' }),
      caption: c.str({ max: 300 }).optional(),
    }),
  ] as const);

  return z.strictObject({
    kind: z.enum(kinds),
    title: c.str({ min: 1, max: 200 }),
    meta: z.strictObject({
      course_title: c.str({ min: 1, max: 160 }),
      subtitle: c.str({ max: 200 }).nullable(),
      generated_on: c.date(),
      language: z.literal('tr'),
      personalized: z.boolean().describe('Belge öğrencinin dossier verisiyle kişiselleştirildi mi'),
      duration_min: c.int({ min: 1, max: 600 }).nullable(),
    }),
    sections: c.arr(z.strictObject({ no: c.int({ min: 0, max: 60 }), title: c.str({ min: 1, max: 160 }) }), { max: 60 }),
    blocks: c.arr(blocks, { min: 1, max: 600 }),
    keys: c.arr(z.strictObject(keyEntryShape(c)), { max: 500 }),
  });
}

export type DocumentAstShape = z.output<ReturnType<typeof makeDocumentAst>>;

/** Çapraz kurallar: blok/bölüm tutarlılığı, şekil yükü, soru ↔ anahtar eşlemesi. */
export function refineDocumentAst(v: DocumentAstShape, ctx: z.RefinementCtx): void {
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
