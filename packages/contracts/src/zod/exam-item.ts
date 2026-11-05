/** exam-item — çıkmış sınavdan çıkarılmış tek soru (v1 + v2 format/trick/difficulty/skill_ids). ocr_text hiçbir öğrenci çıktısına kopyalanmaz. */
import { z } from 'zod';
import { PRESENTATION_FORMATS, skillCode } from './common.js';
import { defineContract } from './kit.js';

export const examItem = defineContract({
  name: 'exam-item',
  title: 'ExamItem',
  description: 'Sınav arşivinden çıkarılmış tek soru (exam_items). ocr_text hiçbir öğrenci çıktısına kopyalanmaz.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      schema_version: z.literal('1.0'),
      source_id: c.uuid(),
      item_no: c.int({ min: 1 }),
      topic: c.str({ max: 120 }),
      kind: z.enum(['proof', 'calc', 'mc', 'other']),
      points: c.num({ min: 0 }).nullable().optional(),
      year: c.int(),
      term: z.enum(['vize', 'final', 'but', 'deneme', 'osym', 'diger']).nullable().optional(),
      instructor_alias: c.str({ pattern: /^hoca-[A-Z]$/ }).nullable().optional(),
      skill_id: skillCode(c).nullable().optional(),
      ocr_text: c.str({ desc: 'Yalnız eğitmen arşivi ve kümeleme; hiçbir öğrenci çıktısına kopyalanmaz' }),
      ocr_confidence: c.prob().optional(),
      format: c.added(z.enum(PRESENTATION_FORMATS), 'other'),
      trick: c.added(c.str({ max: 200 }).nullable(), null),
      difficulty: c.added(c.prob('0..1 zorluk').nullable(), null),
      skill_ids: c.added(c.arr(skillCode(c), { max: 5 }), []),
    }),
});

export type ExamItem = z.output<typeof examItem.strict>;
