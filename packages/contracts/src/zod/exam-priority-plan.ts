/**
 * exam-priority-plan — kalem (b) çıktısı: geçmiş sınavların sıklık analizine göre öncelikler (v1 + `style_ids`).
 * Tahmin değildir; soru metni taşımaz. (v1'deki yasaklı kelime denetimi v2'de kaldırıldı.)
 */
import { z } from 'zod';
import { skillCode } from './common.js';
import { defineContract } from './kit.js';

export const examPriorityPlan = defineContract({
  name: 'exam-priority-plan',
  title: 'ExamPriorityPlan',
  description: 'Geçmiş sınavların sıklık analizine göre öncelikler. Tahmin değildir; soru metni taşımaz.',
  build: (c) =>
    z.strictObject({
      schema_version: z.literal('1.0'),
      course_code: c.str(),
      period: c.str(),
      title: z.literal('Sıklık analizine göre öncelikler'),
      years_total: c.int({ min: 2 }),
      rows: c.arr(
        z.strictObject({
          rank: c.int({ min: 1 }),
          topic: c.str({ max: 80 }),
          kind: z.enum(['ispat', 'hesap', 'çoktan seçmeli', 'diğer']),
          skill_id: skillCode(c).nullable().optional(),
          hits: c.int({ min: 1 }),
          years: c.int({ min: 1 }),
          points_text: c.str({ pattern: /^≈[0-9]+ puan$/ }),
          evidence_count: c.int({ min: 1 }),
          evidence_item_ids: c.arr(c.uuid('Eğitmen arşivine bağlantı; soru metni yok'), { min: 1 }),
          syllabus_alignment: z.enum(['covered_and_asked', 'covered_never_asked', 'asked_not_in_syllabus']),
          variant_question_ids: c.arr(c.uuid('ÖZGÜN varyantlar (questions.source=llm, approved)')).optional(),
          style_ids: c.added(c.arr(c.uuid('question_styles.id')), []),
        }),
        { min: 1, max: 10 },
      ),
      others: c.arr(c.str({ max: 80 })),
      uncovered_topics: c.arr(c.str(), {}).optional(),
      evidence_count: c.int({ min: 1 }),
      generated_at: c.dateTime(),
    }),
});

export type ExamPriorityPlan = z.output<typeof examPriorityPlan.strict>;
