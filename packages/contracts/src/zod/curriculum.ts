/**
 * curriculum — müfredat sürümünün birleşik doğrulaması (v1 zod karşılığı): {curriculum, skills, prerequisites}.
 * Tekil parçalar `curriculum#/$defs/{curriculum,skill,prerequisite}` ile doğrulanır.
 * (Yapay zekâ taslağı için `curriculum-draft`; bu şema yayınlanmış/yüklü sürümün dosya biçimidir.)
 */
import { z } from 'zod';
import { skillCode } from './common.js';
import { defineContract } from './kit.js';

export const curriculum = defineContract({
  name: 'curriculum',
  title: 'CurriculumBundle',
  description: 'Müfredat sürümü: curriculum.json + skills.json + prerequisites.json tek nesnede.',
  build: (c) =>
    z.strictObject({
      schema_version: z.literal('1.0').optional(),
      curriculum: z.strictObject({
        schema_version: z.literal('1.0').optional(),
        code: c.str({ pattern: /^[A-Z0-9]{2,8}(-[A-Z0-9]{2,8})*$/, desc: 'Örnek: TYT-MAT' }),
        authority: z.enum(['MEB', 'ÖSYM', 'UNI', 'OTHER']),
        year: c.int({ min: 2000, max: 2100 }),
        version: c.str({ pattern: /^[0-9]{4}\.[0-9]+$/, desc: 'Örnek: 2026.1' }),
        label: c.str({ min: 3, max: 120 }),
        status: z.enum(['draft', 'active', 'retired']),
        period_label: c.str({ min: 3, max: 40 }).optional(),
        sources: c.arr(c.str({ min: 3 })).optional(),
        diagnostic_exempt: c.arr(skillCode(c)).optional(),
      }),
      skills: c.arr(
        z.strictObject({
          id: skillCode(c),
          parent_id: skillCode(c).nullable(),
          name: c.str({ min: 2, max: 120 }),
          description: c.str({ max: 600 }).nullable().optional(),
          is_leaf: z.boolean(),
          order_no: c.int({ min: 0 }).optional(),
          p_init: c.num({ min: 0.001, max: 0.999 }).optional(),
          p_learn: c.num({ min: 0.001, max: 0.999 }).optional(),
          p_guess: c.num({ min: 0.001, max: 0.999 }).optional(),
          p_slip: c.num({ min: 0.001, max: 0.999 }).optional(),
        }),
        { min: 1 },
      ),
      prerequisites: c.arr(
        z.strictObject({
          skill_id: skillCode(c),
          prereq_id: skillCode(c),
          strength: c.prob(),
          source: z.enum(['curriculum', 'instructor', 'inferred']).optional(),
        }),
      ),
    }),
  defs: {
    curriculum: ['properties', 'curriculum'],
    skill: ['properties', 'skills', 'items'],
    prerequisite: ['properties', 'prerequisites', 'items'],
  },
});

export type Curriculum = z.output<typeof curriculum.strict>;
