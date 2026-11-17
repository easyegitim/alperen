/** weekly-summary — haftalık öğrenci özeti (v1 zod karşılığı): üçüncü tekil, isimsiz; metrikler SQL'den, LLM yalnız metni yazar. */
import { z } from 'zod';
import { skillCode, studentRef } from './common.js';
import { defineContract } from './kit.js';

export const weeklySummary = defineContract({
  name: 'weekly-summary',
  title: 'WeeklySummary',
  description: 'Haftalık özet: metin (3-6 cümle) ve SQL kaynaklı metrikler.',
  build: (c) =>
    z.strictObject({
      schema_version: z.literal('1.0'),
      student_ref: studentRef(c),
      week_start: c.date(),
      body: c.str({ max: 600, desc: '3-6 cümle, üçüncü tekil, isimsiz' }),
      metrics: z.strictObject({
        messages: c.int(),
        questions_solved: c.int(),
        accuracy: c.prob().nullable(),
        active_days: c.int({ min: 0, max: 7 }),
        open_misconceptions: c.int(),
        unanswered_questions: c.int(),
        morale_trend: z.enum(['up', 'flat', 'down', 'unknown']),
        mastery_deltas: c
          .arr(
            z.strictObject({
              skill_id: skillCode(c),
              delta: c.num({ min: -1, max: 1 }),
              reliable: z.boolean().optional(),
            }),
          )
          .optional(),
      }),
      facts_used: c.arr(c.int()),
      next_week_focus: c.arr(skillCode(c), { max: 3 }).optional(),
    }),
});

export type WeeklySummary = z.output<typeof weeklySummary.strict>;
