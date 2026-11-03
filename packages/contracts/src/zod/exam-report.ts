/**
 * exam-report ve report-ast — Sonnet 5.5 rapor belgeleri (PLAN-v2 §8, §10). Belge AST'sinin `report`
 * türüdür; grafikler `chart` bloğuyla anılır, veri render anında deterministik doldurulur.
 */
import type { z } from 'zod';
import { type DocumentAstShape, makeDocumentAst, refineDocumentAst } from './document-ast.js';
import { defineContract } from './kit.js';

export const examReport = defineContract({
  name: 'exam-report',
  title: 'ExamReport',
  description: 'Deneme analiz raporu (belge AST, kind=report): net özeti, bölüm yorumları, kazanım ısı haritası, öneriler.',
  llmOutput: true,
  build: (c) => makeDocumentAst(c, ['report']),
  refine: (v, ctx) => refineDocumentAst(v as DocumentAstShape, ctx),
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
