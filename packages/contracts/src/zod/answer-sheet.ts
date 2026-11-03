/** answer-sheet — Sonnet 5.5 optik form okuma (PLAN-v2 §8): çift işaret boş sayılır ve not düşülür. */
import { z } from 'zod';
import { optionKey5 } from './common.js';
import { addIssue, defineContract } from './kit.js';

export const answerSheet = defineContract({
  name: 'answer-sheet',
  title: 'AnswerSheet',
  description:
    'Optik formdan okunan işaretler. status=multiple (çift işaret) ve unclear için marked_option null olur; not düşülür.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      booklet_type: z.enum(['A', 'B', 'C', 'D', 'unknown']).describe('Formdaki kitapçık türü'),
      answers: c.arr(
        z.strictObject({
          question_no: c.int({ min: 1, max: 500 }),
          status: z.enum(['marked', 'blank', 'multiple', 'unclear']),
          marked_option: optionKey5.nullable().describe('Yalnız status=marked iken dolu'),
          marks_seen: c.arr(optionKey5, { max: 5 }).describe('Satırda görülen tüm işaretler'),
          note: c.str({ max: 200 }).nullable(),
        }),
        { max: 500 },
      ),
    }),
  refine: (v, ctx) => {
    const nos = v.answers.map((a) => a.question_no);
    if (new Set(nos).size !== nos.length) addIssue(ctx, ['answers'], 'soru numaraları tekil olmalı');
    v.answers.forEach((a, i) => {
      if (a.status === 'marked') {
        if (a.marked_option === null) addIssue(ctx, ['answers', i, 'marked_option'], 'marked durumunda marked_option zorunlu');
        else if (!a.marks_seen.includes(a.marked_option)) addIssue(ctx, ['answers', i, 'marks_seen'], 'marks_seen işaretlenen şıkkı içermeli');
      } else if (a.marked_option !== null) {
        addIssue(ctx, ['answers', i, 'marked_option'], 'marked dışındaki durumlarda marked_option null olmalı');
      }
      if (a.status === 'multiple') {
        if (a.marks_seen.length < 2) addIssue(ctx, ['answers', i, 'marks_seen'], 'multiple için en az iki işaret gerekir');
        if (a.note === null) addIssue(ctx, ['answers', i, 'note'], 'çift işarette not düşülmeli');
      }
      if (a.status === 'blank' && a.marks_seen.length > 0) addIssue(ctx, ['answers', i, 'marks_seen'], 'boş satırda işaret olmaz');
    });
  },
});

export type AnswerSheet = z.output<typeof answerSheet.strict>;
