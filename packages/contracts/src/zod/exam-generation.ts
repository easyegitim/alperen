/** exam-generation — Opus 5.5 deneme/soru seti üretimi (PLAN-v2 Akış 5, §7): sorular ve ayrı anahtar. */
import { z } from 'zod';
import { exactlyOneKeyValue, keyEntryShape, optionKey5, skillCode } from './common.js';
import { addIssue, defineContract } from './kit.js';

export const examGeneration = defineContract({
  name: 'exam-generation',
  title: 'ExamGeneration',
  description: 'Üretilen deneme/soru seti: sorular (items) ve doğrulanacak cevap anahtarı (keys) ayrı döner.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      title: c.str({ min: 1, max: 200 }),
      items: c.arr(
        z.strictObject({
          no: c.int({ min: 1, max: 500 }),
          section: c.str({ max: 80 }),
          kind: z.enum(['mcq', 'numeric']),
          stem: c.str({ min: 10, max: 2500 }),
          options: c.arr(z.strictObject({ key: optionKey5, text: c.str({ min: 1, max: 600 }) }), { max: 5 }),
          figure_svg: c.str({ max: 60000 }).nullable().describe('Soru şekli satır içi SVG; yoksa null'),
          skill_ids: c.arr(skillCode(c), { min: 1, max: 3 }),
          style_id: c.uuid('question_styles.id').nullable(),
          difficulty: z.enum(['easy', 'medium', 'hard']),
        }),
        { min: 1, max: 200 },
      ),
      keys: c.arr(
        z.strictObject({ ...keyEntryShape(c), solution: c.str({ min: 10, max: 2000, desc: 'Adım adım çözüm' }) }),
        { min: 1, max: 200 },
      ),
    }),
  refine: (v, ctx) => {
    const nos = new Set<number>();
    v.items.forEach((it, i) => {
      if (nos.has(it.no)) addIssue(ctx, ['items', i, 'no'], `yinelenen soru numarası: ${it.no}`);
      nos.add(it.no);
      if (it.kind === 'mcq') {
        if (it.options.length < 4) addIssue(ctx, ['items', i, 'options'], 'çoktan seçmelide en az dört şık gerekir');
        it.options.forEach((o, j) => {
          if (o.key !== 'ABCDE'[j]) addIssue(ctx, ['items', i, 'options', j, 'key'], 'şık anahtarları A, B, C, D, E sırasında olmalı');
        });
      } else if (it.options.length > 0) addIssue(ctx, ['items', i, 'options'], 'sayısal soruda şık olmaz');
    });
    const keyNos = new Set<number>();
    v.keys.forEach((k, i) => {
      if (keyNos.has(k.question_no)) addIssue(ctx, ['keys', i, 'question_no'], `yinelenen anahtar: ${k.question_no}`);
      keyNos.add(k.question_no);
      const item = v.items.find((it) => it.no === k.question_no);
      if (!item) return addIssue(ctx, ['keys', i, 'question_no'], `anahtarın sorusu yok: ${k.question_no}`);
      if (!exactlyOneKeyValue(k)) return addIssue(ctx, ['keys', i], 'correct_option ile numeric_value\'dan tam biri dolu olmalı');
      if (item.kind === 'mcq' && (k.correct_option === null || !item.options.some((o) => o.key === k.correct_option))) {
        addIssue(ctx, ['keys', i, 'correct_option'], 'doğru şık seçeneklerden biri olmalı');
      }
      if (item.kind === 'numeric' && k.numeric_value === null) addIssue(ctx, ['keys', i, 'numeric_value'], 'sayısal soruda numeric_value zorunlu');
    });
    for (const no of nos) if (!keyNos.has(no)) addIssue(ctx, ['keys'], `soru ${no} için anahtar yok`);
  },
});

export type ExamGeneration = z.output<typeof examGeneration.strict>;
