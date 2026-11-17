/**
 * exam-report ve report-ast — Sonnet 5.5 rapor belgeleri (PLAN-v2 §8, §10). Belge AST'sinin `report`
 * türüdür; grafikler `chart` bloğuyla anılır, veri render anında deterministik doldurulur.
 *
 * Deneme raporu şablonu (`EXAM_REPORT_TEMPLATE`): üç bölüm (genel görünüm, kazanımlar, sonraki adım), ilk bölümün ilk
 * metin bloğu tek cümlelik özet (S05 "tek cümle sonuç"), grafikler yalnız `EXAM_REPORT_CHARTS` veri adlarıyla
 * (packages/doc-render `ChartDataMap` anahtarları; sayı AST'ye girmez). Şablon kuralları yalnız `exam-report`'un loose
 * doğrulamasındadır; `report-ast` serbest kalır.
 */
import type { z } from 'zod';
import { type CHART_KINDS, type DocumentAstShape, makeDocumentAst, refineDocumentAst } from './document-ast.js';
import { addIssue, defineContract } from './kit.js';

/** Deneme raporunda kullanılabilen grafik veri adları → grafik türü (render anında hat doldurur). */
export const EXAM_REPORT_CHARTS = {
  section_nets: 'score_by_section',
  skill_map: 'skill_heatmap',
  error_causes: 'error_cause_histogram',
  time_per_question: 'time_per_question',
  trend: 'mastery_trend',
} as const satisfies Record<string, (typeof CHART_KINDS)[number]>;
export type ExamReportChartRef = keyof typeof EXAM_REPORT_CHARTS;

/** Deneme raporu bölümleri (sıra sabit; başlıklar önerilen metindir, model bölüm başlığını bu adlarla yazar). */
export const EXAM_REPORT_TEMPLATE = {
  sections: [
    { no: 1, key: 'overview', title: 'Genel görünüm' },
    { no: 2, key: 'skills', title: 'Kazanımlar' },
    { no: 3, key: 'next', title: 'Sonraki adım' },
  ],
  /** Sonraki adım kutusunda en çok kaç madde (sadelik). */
  maxNextSteps: 3,
} as const;

/**
 * Tek cümle: içeride cümle bitirip yenisine başlayan nokta yok. Ondalık sayılar, sıra sayıları (`3. Deneme`) ve yaygın
 * kısaltmalar (`vb.`, `örn.`) cümle sonu sayılmaz; cümle sonundan sonra büyük harf, rakam ya da küçük harf gelirse
 * (`yaptın. netin ...`) ikinci cümle vardır.
 */
const SENTENCE_ABBR = /(?<![\p{L}])(?:vb|vs|örn|bkz|dk|sn|sy|yy|tl|dr|prof|doç|yrd|no)\./giu;
function isOneSentence(text: string): boolean {
  const prose = text
    .replace(/\$[^$]*\$/g, 'M')
    .replace(/\d+[.,]\d+/g, 'N')
    .replace(/(?<![\p{L}\d])\d{1,3}\.(?=\s+\p{Lu})/gu, 'N')
    .replace(SENTENCE_ABBR, 'K')
    .trim();
  return !/[.?…]\s+[\p{Lu}\d$MNK]/u.test(prose) && !/[.?…]\s+\p{Ll}/u.test(prose);
}

/** Bloğun okuyucuya görünen metinleri (anahtar sızıntı taraması için). */
function blockTexts(b: DocumentAstShape['blocks'][number]): string[] {
  switch (b.type) {
    case 'heading':
    case 'paragraph':
    case 'common_mistake_callout':
      return [b.text];
    case 'definition_box':
      return [b.term, b.body];
    case 'summary_box':
      return [b.title, ...b.bullets];
    case 'table':
      return [b.caption ?? '', ...b.header, ...b.rows.flat()];
    case 'chart':
      return [b.title, b.caption ?? ''];
    default:
      return [];
  }
}

/** Doğru şık, anahtar ya da öğrencinin işareti rapora yazılamaz (rapor öğrenciye ve veliye gider): "doğru cevap B", "A şıkkı". */
const KEY_LEAK = new RegExp(
  [
    String.raw`(?:[Dd]oğru\s+(?:cevap|şık|yanıt|seçenek)\p{L}*|[Aa]nahtar\p{L}*|[İi]şaretlediğin(?:\s+şık)?)\s*[:=(]?\s*\(?([A-E])(?![\p{L}\d])`,
    String.raw`(?<![\p{L}\d])[A-E]\s+şık\p{L}*`,
    String.raw`(?<![\p{L}\d])[A-E]['’](?:y?[ıiuü]|y?[ae])(?![\p{L}\d])`,
    String.raw`(?<![\p{L}\d])[A-E]\s+seçene\p{L}*`,
    String.raw`[Cc]evab\p{L}*\s+[A-E](?![\p{L}\d])`,
    String.raw`(?<![\p{L}\d])[A-E]\s+işaretle\p{L}*`,
    String.raw`[Aa]nahtar\p{L}*\s+(?:göre\s+)?[A-E](?![\p{L}\d])`,
  ].join('|'),
  'u',
);

function refineExamReport(v: DocumentAstShape, ctx: z.RefinementCtx): void {
  refineDocumentAst(v, ctx);
  const expected = EXAM_REPORT_TEMPLATE.sections.map((s) => s.no);
  const got = v.sections.map((s) => s.no);
  if (JSON.stringify(got) !== JSON.stringify(expected)) addIssue(ctx, ['sections'], `deneme raporu bölümleri ${expected.join(', ')} sırasında olmalı`);
  const firstText = v.blocks.find((b) => b.type !== 'heading');
  if (!firstText || firstText.type !== 'paragraph' || firstText.section_no !== 1) {
    addIssue(ctx, ['blocks'], 'raporun ilk metin bloğu genel görünüm bölümünde tek cümlelik özet paragrafı olmalı');
  } else if (!isOneSentence(firstText.text)) {
    addIssue(ctx, ['blocks'], 'özet paragrafı tek cümle olmalı');
  }
  v.blocks.forEach((b, i) => {
    if (b.type === 'chart') {
      const kind = (EXAM_REPORT_CHARTS as Record<string, string>)[b.data_ref];
      if (kind === undefined) addIssue(ctx, ['blocks', i, 'data_ref'], `bilinmeyen grafik verisi: ${b.data_ref}`);
      else if (kind !== b.chart_kind) addIssue(ctx, ['blocks', i, 'chart_kind'], `${b.data_ref} verisi ${kind} grafiğiyle çizilir`);
    }
    if (blockTexts(b).some((t) => KEY_LEAK.test(t))) addIssue(ctx, ['blocks', i], 'rapor doğru şıkkı, anahtarı ya da öğrencinin işaretlediği şıkkı yazamaz');
    if (b.type === 'summary_box' && b.bullets.length > EXAM_REPORT_TEMPLATE.maxNextSteps) {
      addIssue(ctx, ['blocks', i, 'bullets'], `sonraki adım en çok ${EXAM_REPORT_TEMPLATE.maxNextSteps} madde`);
    }
  });
}

export const examReport = defineContract({
  name: 'exam-report',
  title: 'ExamReport',
  description:
    'Deneme analiz raporu (belge AST, kind=report): tek cümlelik özet, bölüm netleri, kazanım ısı haritası, hata nedenleri, en çok üç sonraki adım. Bölümler 1 genel görünüm, 2 kazanımlar, 3 sonraki adım; grafik data_ref adları section_nets, skill_map, error_causes, time_per_question, trend.',
  llmOutput: true,
  build: (c) => makeDocumentAst(c, ['report']),
  refine: (v, ctx) => refineExamReport(v as DocumentAstShape, ctx),
});

export const reportAst = defineContract({
  name: 'report-ast',
  title: 'ReportAst',
  description: 'İstek üzerine rapor (haftalık, konu, trend, özel; veli ve öğrenci için): belge AST, kind=report.',
  llmOutput: true,
  build: (c) => makeDocumentAst(c, ['report']),
  refine: (v, ctx) => refineDocumentAst(v as DocumentAstShape, ctx),
});

export type ExamReport = z.output<typeof examReport.strict>;
export type ReportAst = z.output<typeof reportAst.strict>;
