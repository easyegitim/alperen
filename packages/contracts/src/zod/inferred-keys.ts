/** inferred-keys — Opus 5.5 + code_execution anahtar çıkarımı (anahtar yoksa; PLAN-v2 §8). Düşük güven "doğrulanmadı" etiketi alır. */
import { z } from 'zod';
import { exactlyOneKeyValue, keyEntryShape } from './common.js';
import { addIssue, defineContract } from './kit.js';

export const inferredKeys = defineContract({
  name: 'inferred-keys',
  title: 'InferredKeys',
  description: 'Anahtarı olmayan denemede çıkarılan cevap anahtarı: soru başına şık ya da sayısal değer, özet çözüm, güven ve kodla doğrulandı mı.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      keys: c.arr(
        z.strictObject({
          ...keyEntryShape(c),
          solution_summary: c.str({ max: 800 }),
          confidence: c.prob(),
          checked_with_code: z.boolean().describe('Sonuç code_execution ile doğrulandı mı'),
        }),
        { max: 500 },
      ),
      notes: c.str({ max: 600 }).nullable(),
    }),
  refine: (v, ctx) => {
    const nos = v.keys.map((k) => k.question_no);
    if (new Set(nos).size !== nos.length) addIssue(ctx, ['keys'], 'soru numaraları tekil olmalı');
    v.keys.forEach((k, i) => {
      if (!exactlyOneKeyValue(k)) addIssue(ctx, ['keys', i], 'correct_option ile numeric_value\'dan tam biri dolu olmalı');
    });
  },
});

export type InferredKeys = z.output<typeof inferredKeys.strict>;
