/**
 * question-item — soru maddesi (v1 sözleşmesinin zod karşılığı). Cevap anahtarı BU NESNEDE YOKTUR
 * (`answer-key` ayrı sözleşmedir). `questions` satırı ve tarza özel üretimin doğrulama merdiveni bunu kullanır.
 */
import { z } from 'zod';
import { OPTION_KEYS_4, optionKey4, skillCode, tagCode } from './common.js';
import { addIssue, defineContract } from './kit.js';

export const FIGURE_TOOLS = ['matplotlib', 'svg', 'tikz', 'vega-lite', 'schemdraw', 'rdkit', 'graphviz', 'latex', 'template'] as const;

export const questionItem = defineContract({
  name: 'question-item',
  title: 'QuestionItem',
  description: 'Soru maddesi. Cevap anahtarı BU NESNEDE YOKTUR (answer-key ayrı sözleşmedir).',
  build: (c) => {
    const scalar = z.union([z.number(), z.string(), z.boolean(), z.null()]);
    return z.strictObject({
      schema_version: z.literal('1.0'),
      id: c.uuid().optional(),
      curriculum_code: c.str({ pattern: /^[A-Z0-9]{2,8}(-[A-Z0-9]{2,8})*@[0-9]{4}\.[0-9]+$/, desc: 'Örnek: TYT-MAT@2026.1' }),
      kind: z.enum(['mcq', 'numeric']),
      skill_ids: c.arr(skillCode(c), { min: 1, max: 3 }),
      stem: c.str({ min: 10, max: 900, desc: 'Soru kökü; formüller düz metin/kod; şekil varsa kök şekli kelimelerle de anlatır' }),
      stem_values: z.record(z.string(), z.union([z.number(), z.string()])).optional().describe('Şekil denetiminin karşılaştırdığı değerler'),
      figure: z
        .strictObject({
          tool: z.enum(FIGURE_TOOLS),
          code: c.str({ min: 1, max: 20000 }),
          alt_text: c.str({ min: 15, max: 400, desc: 'Şekli kelimelerle anlatır' }),
          expected_px: z
            .strictObject({
              min_w: c.int().optional(),
              max_w: c.int().optional(),
              min_h: c.int().optional(),
              max_h: c.int().optional(),
            })
            .optional(),
          render: z
            .strictObject({
              status: z.enum(['pending', 'rendered', 'failed']).optional(),
              png_path: c.str().optional(),
              width_px: c.int().optional(),
              height_px: c.int().optional(),
              bytes: c.int().optional(),
              vision: z.enum(['pending', 'match', 'mismatch', 'not_applicable', 'skipped']).optional(),
              attempts: c.int({ min: 0, max: 3 }).optional(),
            })
            .optional(),
        })
        .nullable(),
      options: c
        .arr(
          z.strictObject({
            key: optionKey4,
            text: c.str({ min: 1, max: 200 }),
            misconception_tag: tagCode(c, 'Yanlış şıkkın kodladığı yanılgı; doğru şık ve en az bir çeldirici null taşır').nullable(),
          }),
          { min: 4, max: 4 },
        )
        .optional()
        .describe('Tam dört şık, anahtarlar sırayla A, B, C, D; en az iki şık misconception_tag=null taşır'),
      difficulty: c.prob().optional(),
      source: z.enum(['template', 'llm', 'instructor', 'diagnostic']),
      template: z.strictObject({ id: c.str().optional(), params: z.record(z.string(), z.union([scalar, z.array(scalar), z.record(z.string(), scalar)])).optional() }).optional(),
      verification: z.strictObject({
        schema: z.boolean(),
        sympy: z.enum(['verified', 'failed', 'not_applicable', 'pending']),
        render: z.enum(['ok', 'failed', 'size_mismatch', 'not_applicable', 'pending']),
        vision: z.enum(['match', 'mismatch', 'not_applicable', 'pending', 'skipped']),
        attempts: c.int({ min: 0, max: 3 }),
        status: z.enum(['draft', 'pending_review', 'approved', 'rejected', 'retired']),
        review_note: c.str().nullable().optional(),
      }),
      provenance: z
        .strictObject({
          model: c.str().optional(),
          cost_usd: c.num({ min: 0 }).optional(),
          prompt_version: c.str().optional(),
          prompt_hash: c.str().optional(),
          created_at: c.dateTime().optional(),
        })
        .optional(),
    });
  },
  jsonSchemaPatch: (doc) => {
    const props = doc.properties as Record<string, Record<string, unknown>>;
    // En az iki şık misconception_tag=null taşır; anahtarlar sırayla A, B, C, D (diagnostic-test `#/properties/options` ile miras alır).
    props.options = {
      ...props.options,
      contains: { type: 'object', required: ['misconception_tag'], properties: { misconception_tag: { type: 'null' } } },
      minContains: 2,
      allOf: [{ minItems: 4, maxItems: 4, prefixItems: OPTION_KEYS_4.map((k) => ({ properties: { key: { const: k } } })) }],
    };
    doc.allOf = [
      { if: { properties: { kind: { const: 'mcq' } } }, then: { required: ['options'] } },
      { if: { properties: { kind: { const: 'numeric' } } }, then: { not: { required: ['options'] } } },
      {
        if: { properties: { verification: { properties: { status: { const: 'approved' } } } } },
        then: { properties: { verification: { properties: { sympy: { enum: ['verified', 'not_applicable'] } } } } },
      },
    ];
  },
  refine: (v, ctx) => {
    if (v.kind === 'mcq' && v.options === undefined) addIssue(ctx, ['options'], 'çoktan seçmeli soruda options zorunlu');
    if (v.kind === 'numeric' && v.options !== undefined) addIssue(ctx, ['options'], 'sayısal soruda options olmaz');
    if (v.options) {
      v.options.forEach((o, i) => {
        if (o.key !== OPTION_KEYS_4[i]) addIssue(ctx, ['options', i, 'key'], 'şık anahtarları sırayla A, B, C, D olmalı');
      });
      if (v.options.filter((o) => o.misconception_tag === null).length < 2) {
        addIssue(ctx, ['options'], 'en az iki şık misconception_tag=null taşımalı (doğru şık etiket dizisinden çıkarılamaz)');
      }
    }
    if (v.verification.status === 'approved' && v.verification.sympy !== 'verified' && v.verification.sympy !== 'not_applicable') {
      addIssue(ctx, ['verification', 'sympy'], 'onaylı soruda sympy verified ya da not_applicable olmalı');
    }
  },
});

export type QuestionItem = z.output<typeof questionItem.strict>;
