/** memory-fact — gece olgu çıkarımının tek olgusu (v1 zod karşılığı; memory_facts satırı). Kaynak mesaj numarası zorunlu; ad içermez. */
import { z } from 'zod';
import { skillCode, studentRef } from './common.js';
import { addIssue, defineContract } from './kit.js';

export const memoryFact = defineContract({
  name: 'memory-fact',
  title: 'MemoryFact',
  description: 'Tek olgu: tür, metin (isimsiz), kaynak mesaj numaraları, güven, onay gerekliliği.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      schema_version: z.literal('1.0'),
      student_ref: studentRef(c),
      kind: z.enum(['promise', 'deadline', 'unanswered_question', 'morale', 'topic_asked', 'preference', 'instructor_fact', 'other']),
      text: c.str({ min: 8, max: 300, desc: "İsim yok; 'öğrenci' veya 'eğitmen' der; üçüncü tekil" }),
      source_message_ids: c.arr(c.int(), { min: 1, max: 8 }),
      confidence: c.prob(),
      valid_until: c.date().nullable().optional(),
      morale_signal: c.int({ min: -2, max: 2 }).nullable().optional(),
      requires_approval: z.boolean().describe('not/devamsızlık/puan/ödeme içeriyorsa true'),
      skill_id: skillCode(c).nullable().optional(),
    }),
  jsonSchemaPatch: (doc) => {
    doc.allOf = [{ if: { properties: { kind: { const: 'instructor_fact' } } }, then: { properties: { requires_approval: { const: true } } } }];
  },
  refine: (v, ctx) => {
    if (v.kind === 'instructor_fact' && !v.requires_approval) addIssue(ctx, ['requires_approval'], 'eğitmen olgusu onay gerektirir');
  },
});

export type MemoryFact = z.output<typeof memoryFact.strict>;
