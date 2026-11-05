/** eval-verdict — Opus 5.5 eval hakemi (PLAN-v2 §6, §11): bozulan adım, neden, kazanım uyumu ve Türkçe ton rubriği. */
import { z } from 'zod';
import { defineContract } from './kit.js';

export const evalVerdict = defineContract({
  name: 'eval-verdict',
  title: 'EvalVerdict',
  description: 'Bir eval vakasının hakem puanı: bozulan adım, hata nedeni, kazanım uyumu, Türkçe ton (1-5) ve gerekçe.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      failing_step_match: z.enum(['exact', 'near', 'miss']),
      cause_match: z.boolean(),
      skills_match: z.enum(['full', 'partial', 'none']),
      tone_score: c.int({ min: 1, max: 5, desc: 'Türkçe ton rubriği: 5 = sen dili, sıcak, ünlemsiz, yargılamayan' }),
      overall: c.prob('0..1 toplam puan'),
      pass: z.boolean(),
      rationale: c.str({ min: 5, max: 800 }),
      issues: c.arr(c.str({ min: 1, max: 200 }), { max: 8 }),
    }),
});

export type EvalVerdict = z.output<typeof evalVerdict.strict>;
