/** figure-render-report — şekil denetim raporu (v1 zod karşılığı): Haiku vision çıktısı {matches_stem, mismatches, notes}. */
import { z } from 'zod';
import { FIGURE_TOOLS } from './question-item.js';
import { addIssue, defineContract } from './kit.js';

export const figureRenderReport = defineContract({
  name: 'figure-render-report',
  title: 'FigureRenderReport',
  description:
    'Şekil denetim raporu: PNG ile stem_values karşılaştırması; isteğe bağlı render özeti. mismatch durumunda kod düzeltilip yeniden üretilir.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      schema_version: z.literal('1.0').optional(),
      figure_id: c.uuid().optional(),
      matches_stem: z.boolean().describe('Şekil soru kökündeki değerlerle uyuşuyor mu'),
      status: z.enum(['match', 'mismatch']).optional(),
      mismatches: c.arr(
        z.union([
          c.str({ min: 1, max: 300 }),
          z.strictObject({
            field: c.str({ min: 1, max: 80, desc: 'stem_values anahtarı ya da şekil öğesi' }),
            expected: z.union([z.number(), z.string(), z.null()]).optional(),
            observed: z.union([z.number(), z.string(), z.null()]).optional(),
            note: c.str({ max: 300 }).optional(),
          }),
        ]),
        { max: 20 },
      ),
      notes: c.str({ max: 600 }).nullable().optional(),
      render: z
        .strictObject({
          status: z.enum(['ok', 'failed', 'size_mismatch', 'blank', 'skipped']),
          tool: z.enum(FIGURE_TOOLS).optional(),
          width_px: c.int({ min: 0 }).optional(),
          height_px: c.int({ min: 0 }).optional(),
          bytes: c.int({ min: 0 }).optional(),
          pixel_variance: c.num({ min: 0 }).optional(),
          duration_ms: c.int({ min: 0 }).optional(),
          log: c.str({ max: 4000 }).optional(),
        })
        .optional(),
    }),
  jsonSchemaPatch: (doc) => {
    doc.allOf = [
      {
        if: { properties: { matches_stem: { const: true } }, required: ['matches_stem'] },
        then: { properties: { mismatches: { maxItems: 0 }, status: { const: 'match' } } },
      },
      {
        if: { properties: { matches_stem: { const: false } }, required: ['matches_stem'] },
        then: { properties: { mismatches: { minItems: 1 }, status: { const: 'mismatch' } } },
      },
    ];
  },
  refine: (v, ctx) => {
    if (v.matches_stem) {
      if (v.mismatches.length > 0) addIssue(ctx, ['mismatches'], 'matches_stem=true iken mismatches boş olmalı');
      if (v.status !== undefined && v.status !== 'match') addIssue(ctx, ['status'], 'matches_stem=true iken status=match olmalı');
    } else {
      if (v.mismatches.length < 1) addIssue(ctx, ['mismatches'], 'matches_stem=false iken en az bir uyuşmazlık yazılmalı');
      if (v.status !== undefined && v.status !== 'mismatch') addIssue(ctx, ['status'], 'matches_stem=false iken status=mismatch olmalı');
    }
  },
});

export type FigureRenderReport = z.output<typeof figureRenderReport.strict>;
