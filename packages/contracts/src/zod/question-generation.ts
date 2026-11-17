/**
 * question-generation (v2) — Opus 5.5 tarza özel soru üretimi (PLAN-v2 §5 rota tablosu): 1-10 soru, her soru bir
 * `style_id` taşır (`question_styles.id`), cevap anahtarı ayrı `keys[]`'te döner ve SymPy/code_execution ile doğrulanır.
 * `exam-generation` ile aynı soru/anahtar biçimini paylaşır; fark: `style_id` zorunlu, en çok 10 soru.
 *
 * Ad notu: v1 tablet zarfı (`{item, key}`) `question-generation` adıyla legacy dosya olarak yaşıyor (Python tablet boru hattı);
 * v2 sözleşme çakışmasın diye `style-question-generation` adıyla kayıtlıdır.
 */
import { z } from 'zod';
import { generatedItem, generatedKey, refineGeneratedSet } from './exam-generation.js';
import { addIssue, defineContract } from './kit.js';

export const styleQuestionGeneration = defineContract({
  name: 'style-question-generation',
  title: 'StyleQuestionGeneration',
  description: 'Tarza özel üretilen sorular (1-10): her soruda zorunlu style_id; doğrulanacak cevap anahtarı keys[] ayrı döner.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      items: c.arr(generatedItem(c, { styleRequired: true }), { min: 1, max: 10 }),
      keys: c.arr(generatedKey(c), { min: 1, max: 10 }),
    }),
  refine: (v, ctx) => {
    refineGeneratedSet(v, ctx);
    v.items.forEach((it, i) => {
      if (it.style_id === null) addIssue(ctx, ['items', i, 'style_id'], 'style_id zorunlu');
    });
  },
});

export type StyleQuestionGeneration = z.output<typeof styleQuestionGeneration.strict>;
