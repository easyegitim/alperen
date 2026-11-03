/** exam-page-items — Sonnet 5.5 sayfa başına yapılandırılmış OCR (PLAN-v2 §8): sayfadaki sorular. */
import { z } from 'zod';
import { addIssue, defineContract } from './kit.js';
import { optionKey5 } from './common.js';

export const examPageItems = defineContract({
  name: 'exam-page-items',
  title: 'ExamPageItems',
  description:
    'Bir kitapçık sayfasındaki sorular: numara, bölüm, tür, kök metni, şıklar, sayfalar arası devam bayrakları ve şekil kutuları (0..1 oranlı).',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      items: c.arr(
        z.strictObject({
          no: c.int({ min: 1, max: 500 }),
          section: c.str({ max: 80 }).nullable(),
          kind: z.enum(['mcq', 'numeric', 'open']),
          stem_text: c.str({ max: 4000 }),
          options: c.arr(z.strictObject({ key: optionKey5, text: c.str({ max: 600 }) }), { max: 5 }),
          continues_from_previous: z.boolean().describe('Soru önceki sayfadan devam ediyor'),
          continues_on_next: z.boolean().describe('Soru sonraki sayfada sürüyor'),
          figures: c.arr(
            z.strictObject({
              bbox: z.strictObject({ x: c.prob(), y: c.prob(), w: c.prob(), h: c.prob() }),
              description: c.str({ max: 200 }),
            }),
            { max: 4 },
          ),
          legibility: z.enum(['clear', 'partial', 'poor']),
        }),
        { max: 60 },
      ),
      page_notes: c.str({ max: 400 }).nullable(),
    }),
  refine: (v, ctx) => {
    const nos = v.items.map((i) => i.no);
    if (new Set(nos).size !== nos.length) addIssue(ctx, ['items'], 'soru numaraları tekil olmalı');
    v.items.forEach((it, i) => {
      const keys = it.options.map((o) => o.key);
      if (new Set(keys).size !== keys.length) addIssue(ctx, ['items', i, 'options'], 'şık anahtarları tekil olmalı');
      const partial = it.continues_from_previous || it.continues_on_next;
      if (it.kind === 'mcq' && it.options.length < 2 && !partial) addIssue(ctx, ['items', i, 'options'], 'çoktan seçmeli soruda en az iki şık gerekir');
      if (it.kind !== 'mcq' && it.options.length > 0) addIssue(ctx, ['items', i, 'options'], 'mcq dışı soruda şık olmaz');
      it.figures.forEach((f, j) => {
        if (f.bbox.x + f.bbox.w > 1.001 || f.bbox.y + f.bbox.h > 1.001) {
          addIssue(ctx, ['items', i, 'figures', j, 'bbox'], 'şekil kutusu sayfanın dışına taşıyor');
        }
      });
    });
  },
});

export type ExamPageItems = z.output<typeof examPageItems.strict>;
