/** style-definition — Sonnet 5.5 tarz adlandırma (PLAN-v2 §11): kümeye ad, tanım ve özellikler. Örnek soru metni taşımaz. */
import { z } from 'zod';
import { skillCode, styleCode } from './common.js';
import { addIssue, defineContract } from './kit.js';

export const STYLE_FORMATS = ['mcq', 'numeric', 'open', 'proof', 'other'] as const;

export const styleDefinition = defineContract({
  name: 'style-definition',
  title: 'StyleDefinition',
  description: 'Soru tarzı tanımları: küme kimliği, kod, ad, tanım (telifli örnek metni içermez), format, tuzak, zorluk bandı, kazanımlar.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      styles: c.arr(
        z.strictObject({
          cluster_id: c.str({ min: 1, max: 80, desc: 'Girdideki küme kimliği' }),
          code: styleCode(c),
          name: c.str({ min: 3, max: 80 }),
          description: c.str({ min: 10, max: 500, desc: 'Tarzın tanımı; soru metninden alıntı yapmaz' }),
          format: z.enum(STYLE_FORMATS),
          trick: c.str({ max: 200 }).nullable().describe('Soruyu tuzaklı yapan unsur; yoksa null'),
          difficulty_band: z.enum(['easy', 'medium', 'hard']),
          skill_ids: c.arr(skillCode(c), { max: 5 }),
        }),
        { min: 1, max: 60 },
      ),
    }),
  refine: (v, ctx) => {
    const codes = new Set<string>();
    const clusters = new Set<string>();
    v.styles.forEach((s, i) => {
      if (codes.has(s.code)) addIssue(ctx, ['styles', i, 'code'], `yinelenen tarz kodu: ${s.code}`);
      codes.add(s.code);
      if (clusters.has(s.cluster_id)) addIssue(ctx, ['styles', i, 'cluster_id'], `küme birden çok kez adlandırılmış: ${s.cluster_id}`);
      clusters.add(s.cluster_id);
    });
  },
});

export type StyleDefinition = z.output<typeof styleDefinition.strict>;
