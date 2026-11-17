/** answer-key — cevap anahtarı (v1 sözleşmesinin zod karşılığı): `secure.answer_keys` satırı. Soru nesnesine asla karışmaz. */
import { z } from 'zod';
import { optionKey4 } from './common.js';
import { addIssue, defineContract } from './kit.js';

export const answerKey = defineContract({
  name: 'answer-key',
  title: 'AnswerKey',
  description: 'Cevap anahtarı: doğru şık ya da sayısal değer, adım adım çözüm ve SymPy doğrulama durumu.',
  build: (c) =>
    z.strictObject({
      question_id: c.uuid(),
      correct_option: optionKey4.optional(),
      numeric_value: c.str({ desc: "SymPy dizesi: '7/8', '2*sqrt(3)'" }).optional(),
      numeric_tolerance: c.num({ min: 0 }).optional(),
      canonical_expr: c.str({ desc: 'sympy.sympify edilebilir ifade; stem_values ile çözülür' }).optional(),
      solution: c.str({ min: 10, max: 2000, desc: 'Adım adım çözüm' }),
      sympy_status: z.enum(['verified', 'failed', 'not_applicable']),
      sympy_report: z
        .strictObject({
          expr: c.str().optional(),
          value: c.str().optional(),
          matched_option: c.str().nullable().optional(),
          note: c.str().optional(),
        })
        .optional(),
    }),
  jsonSchemaPatch: (doc) => {
    doc.oneOf = [{ required: ['correct_option'] }, { required: ['numeric_value'] }];
  },
  refine: (v, ctx) => {
    if ((v.correct_option !== undefined) === (v.numeric_value !== undefined)) {
      addIssue(ctx, [], 'correct_option ile numeric_value\'dan tam biri verilmeli');
    }
  },
});

export type AnswerKey = z.output<typeof answerKey.strict>;
