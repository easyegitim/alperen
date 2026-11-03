/**
 * lesson-analysis — ders videosu analizi (v1 + v2 `course_insights`). Her kazanım iddiası zaman damgalı
 * alıntıyla gelir; adlar yerine ÖĞRENCİ/EĞİTMEN etiketi. v2 alanı loose kipte varsayılan [] alır (eski veri geçerli).
 */
import { z } from 'zod';
import { speaker, skillCode, studentRef, tagCode, timedQuote, timestamp } from './common.js';
import { defineContract } from './kit.js';

export const COURSE_INSIGHT_KINDS = ['syllabus_topic', 'exam_hint', 'assignment', 'resource', 'other'] as const;

export const lessonAnalysis = defineContract({
  name: 'lesson-analysis',
  title: 'LessonAnalysis',
  description:
    'Ders videosu analizi: kazanımlar (alıntılı kanıtla), sorular, tereddütler, yanılgılar, taahhütler, konuşma dengesi, ders bilgisi (course_insights).',
  llmOutput: true,
  build: (c) => {
    const evidence = timedQuote(c);
    const nullableSkill = skillCode(c).nullable();
    return z.strictObject({
      schema_version: z.literal('1.0'),
      lesson_ref: c.uuid(),
      student_ref: studentRef(c),
      duration_min: c.int({ min: 1 }).optional(),
      skills: c.arr(
        z.strictObject({
          skill_id: skillCode(c),
          mastery_estimate: c.prob(),
          confidence: c.prob(),
          evidence: c.arr(evidence, { min: 1, max: 5 }),
        }),
      ),
      questions: c.arr(
        z.strictObject({ t: timestamp(c), quote: c.str({ max: 300 }), skill_id: nullableSkill.optional(), answered: z.boolean().optional() }),
      ),
      hesitations: c.arr(
        z.strictObject({
          t: timestamp(c),
          kind: z.enum(['said_dont_understand', 'long_silence', 'wrong_answer', 'asked_repeat']),
          quote: c.str({ max: 300 }).optional(),
          skill_id: nullableSkill.optional(),
        }),
      ),
      misconceptions: c.arr(
        z.strictObject({
          tag: tagCode(c, 'Katalogdaki etiket; yoksa null ve metin serbest').nullable().optional(),
          skill_id: skillCode(c),
          text_instructor: c.str({ max: 200 }),
          text_student: c.str({ max: 200 }),
          resolved_in_lesson: z.boolean().optional(),
          evidence: c.arr(evidence, { min: 1 }),
        }),
      ),
      commitments: c.arr(
        z.strictObject({
          who: speaker,
          kind: z.enum(['homework', 'promise', 'deadline']),
          text: c.str({ max: 300 }),
          due: c.date().nullable().optional(),
          t: timestamp(c),
        }),
      ),
      talk: z.strictObject({
        student_ratio: c.prob(),
        student_questions: c.int({ min: 0 }),
        attention: z.enum(['low', 'medium', 'high']),
        morale: z.enum(['low', 'medium', 'high', 'unknown']),
        notes: c.str({ max: 300 }).optional(),
      }),
      previous_profile_check: c.arr(
        z.strictObject({
          misconception_id: c.uuid(),
          status: z.enum(['still_present', 'improved', 'not_observed']),
          evidence: c.arr(evidence).optional(),
        }),
      ),
      next_step: z.strictObject({ for_student: c.str({ max: 400 }), for_instructor: c.str({ max: 400 }) }),
      course_insights: c.added(
        c.arr(
          z.strictObject({
            kind: z.enum(COURSE_INSIGHT_KINDS),
            topic: c.str({ max: 120 }),
            text: c.str({ max: 400 }),
            skill_id: skillCode(c).nullable(),
            evidence: c.arr(evidence, { max: 3 }),
          }),
          { max: 20 },
        ),
        [],
      ),
      model_notes: z.strictObject({
        model: c.str(),
        prompt_version: c.str(),
        cost_usd: c.num({ min: 0 }),
        tokens_in: c.int(),
        tokens_out: c.int(),
        frames: c.int().optional(),
      }),
    });
  },
});

export type LessonAnalysis = z.output<typeof lessonAnalysis.strict>;
