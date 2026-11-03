/**
 * curriculum-draft — Opus 5.5 müfredat taslağı (PLAN-v2 §3.5). Düz şema: özyineleme yok, ağaç
 * `parent_code` ile kurulur. Doğrulama (tek kök, döngüsüz, derinlik <= 4) loose şemadadır.
 */
import { z } from 'zod';
import { skillCode, tagCode } from './common.js';
import { addIssue, defineContract } from './kit.js';

export const CURRICULUM_MAX_DEPTH = 4;

export const curriculumDraft = defineContract({
  name: 'curriculum-draft',
  title: 'CurriculumDraft',
  description:
    'Müfredat taslağı: düz düğüm listesi (parent_code ile ağaç), ön koşullar, yanılgı etiketleri, güven ve eğitmen notu. ' +
    'Tek kök, döngüsüz, derinlik en çok 4.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      nodes: c.arr(
        z.strictObject({
          code: skillCode(c, 'Tekil kod; küçük harf, noktalı yol'),
          parent_code: skillCode(c).nullable().describe('Kök için null'),
          name: c.str({ min: 2, max: 120 }),
          description: c.str({ max: 400 }),
          kind: z.enum(['unit', 'outcome', 'sub_outcome']),
          exam_weight_hint: c.prob('Sınavdaki tahmini göreli ağırlık (0..1); bilinmiyorsa null').nullable(),
          sources: c.arr(c.str({ min: 1, max: 300 }), { max: 8 }),
        }),
        { min: 1, max: 400 },
      ),
      prerequisites: c.arr(
        z.strictObject({ skill_code: skillCode(c), prereq_code: skillCode(c), strength: c.prob() }),
        { max: 800 },
      ),
      misconception_tags: c.arr(
        z.strictObject({
          tag: tagCode(c),
          skill_code: skillCode(c),
          text_instructor: c.str({ min: 5, max: 200 }),
          text_student: c.uiText({ min: 5, max: 200 }),
        }),
        { max: 400 },
      ),
      confidence: c.prob(),
      notes_for_instructor: c.str({ max: 2000 }),
    }),
  refine: (v, ctx) => {
    const byCode = new Map<string, (typeof v.nodes)[number]>();
    v.nodes.forEach((n, i) => {
      if (byCode.has(n.code)) addIssue(ctx, ['nodes', i, 'code'], `yinelenen kod: ${n.code}`);
      byCode.set(n.code, n);
    });
    const roots = v.nodes.filter((n) => n.parent_code === null);
    if (roots.length !== 1) addIssue(ctx, ['nodes'], `tam bir kök olmalı (bulunan: ${roots.length})`);
    v.nodes.forEach((n, i) => {
      if (n.parent_code !== null && !byCode.has(n.parent_code)) {
        addIssue(ctx, ['nodes', i, 'parent_code'], `bilinmeyen üst düğüm: ${n.parent_code}`);
      }
    });
    // Döngü ve derinlik: her düğümden köke yürü.
    for (const [i, n] of v.nodes.entries()) {
      let depth = 1;
      let cur = n;
      const seen = new Set<string>([cur.code]);
      while (cur.parent_code !== null) {
        const parent = byCode.get(cur.parent_code);
        if (!parent) break;
        if (seen.has(parent.code)) {
          addIssue(ctx, ['nodes', i, 'parent_code'], 'üst düğüm zincirinde döngü var');
          break;
        }
        seen.add(parent.code);
        cur = parent;
        depth += 1;
      }
      if (depth > CURRICULUM_MAX_DEPTH) addIssue(ctx, ['nodes', i], `derinlik ${CURRICULUM_MAX_DEPTH} değerini aşıyor`);
    }
    // Ön koşullar: var olan düğümler, kendine bağ yok, döngü yok.
    const edges = new Map<string, string[]>();
    v.prerequisites.forEach((p, i) => {
      if (!byCode.has(p.skill_code)) addIssue(ctx, ['prerequisites', i, 'skill_code'], `bilinmeyen kod: ${p.skill_code}`);
      if (!byCode.has(p.prereq_code)) addIssue(ctx, ['prerequisites', i, 'prereq_code'], `bilinmeyen kod: ${p.prereq_code}`);
      if (p.skill_code === p.prereq_code) addIssue(ctx, ['prerequisites', i], 'kazanım kendisinin ön koşulu olamaz');
      edges.set(p.skill_code, [...(edges.get(p.skill_code) ?? []), p.prereq_code]);
    });
    const state = new Map<string, 1 | 2>();
    const visit = (code: string): boolean => {
      if (state.get(code) === 2) return false;
      if (state.get(code) === 1) return true;
      state.set(code, 1);
      for (const next of edges.get(code) ?? []) if (visit(next)) return true;
      state.set(code, 2);
      return false;
    };
    if ([...edges.keys()].some((k) => visit(k))) addIssue(ctx, ['prerequisites'], 'ön koşul grafiğinde döngü var');
    const tags = new Set<string>();
    v.misconception_tags.forEach((t, i) => {
      if (tags.has(t.tag)) addIssue(ctx, ['misconception_tags', i, 'tag'], `yinelenen etiket: ${t.tag}`);
      tags.add(t.tag);
      if (!byCode.has(t.skill_code)) addIssue(ctx, ['misconception_tags', i, 'skill_code'], `bilinmeyen kod: ${t.skill_code}`);
    });
  },
});

export type CurriculumDraft = z.output<typeof curriculumDraft.strict>;
