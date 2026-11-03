// Alıştırma RPC'lerinin (supabase/migrations/0021_practice.sql; supabase/README.md "P1 RPC'leri") yanıt biçimleri.
// Doğru şık hiçbir yanıtta yoktur; burada da tutulmaz.
import { z } from 'zod';

export const PRACTICE_STATUSES = ['needs_generation', 'in_progress', 'finished', 'abandoned'] as const;
export type PracticeStatus = (typeof PRACTICE_STATUSES)[number];

const option = z.object({ key: z.string(), text: z.string() });
const figure = z.object({ id: z.string(), png_path: z.string().nullable().optional(), svg_path: z.string().nullable().optional(), alt_text: z.string().nullable().optional() });

const item = z.object({
  no: z.number().int(),
  question_id: z.string(),
  kind: z.enum(['mcq', 'numeric']),
  stem: z.string(),
  options: z.array(option).nullable().optional(),
  figure: figure.nullable().optional(),
  skill_ids: z.array(z.string()).default([]),
  answered: z.boolean(),
  correct: z.boolean().nullable().optional(),
});

const misconception = z.object({ tag: z.string(), text: z.string().nullable(), count: z.number() });
const skillScore = z.object({ skill_id: z.string(), name: z.string(), correct: z.number(), total: z.number() });

export const finishSummarySchema = z.object({
  set_id: z.string(),
  status: z.enum(['finished', 'abandoned']),
  total: z.number(),
  answered: z.number(),
  correct: z.number(),
  wrong: z.number(),
  unanswered: z.number(),
  top_misconception: misconception.nullable().optional(),
  weak_skill: skillScore.extend({ band: z.enum(['low', 'mid', 'high']).nullable().optional() }).nullable().optional(),
  skills: z.array(skillScore).default([]),
  mastery: z.array(z.object({ skill_id: z.string(), p_before: z.number().nullable(), p_after: z.number().nullable() })).default([]),
  finished_at: z.string().nullable().optional(),
});

export const practiceSetSchema = z.object({
  set_id: z.string(),
  enrollment_id: z.string(),
  suggestion_id: z.string().nullable().optional(),
  status: z.enum(PRACTICE_STATUSES),
  skill_ids: z.array(z.string()).default([]),
  target_count: z.number(),
  total: z.number(),
  answered: z.number(),
  summary: finishSummarySchema.nullable().optional(),
  items: z.array(item).default([]),
});

export const answerResultSchema = z.object({
  set_id: z.string(),
  question_id: z.string(),
  no: z.number(),
  correct: z.boolean(),
  misconception_tag: z.string().nullable().optional(),
  misconception_text: z.string().nullable().optional(),
  answered: z.number(),
  total: z.number(),
  remaining: z.number(),
  already_answered: z.boolean().default(false),
});

export type PracticeSet = z.infer<typeof practiceSetSchema>;
export type PracticeItem = PracticeSet['items'][number];
export type AnswerResult = z.infer<typeof answerResultSchema>;
export type FinishSummary = z.infer<typeof finishSummarySchema>;

export const parsePracticeSet = (raw: unknown): PracticeSet => practiceSetSchema.parse(raw);
export const parseAnswerResult = (raw: unknown): AnswerResult => answerResultSchema.parse(raw);
export const parseFinishSummary = (raw: unknown): FinishSummary => finishSummarySchema.parse(raw);

/** İstemciye giden soru: yalnız ekranın gerektirdiği alanlar (şekil adresi sunucuda çözülür). */
export interface PlayerItem {
  no: number;
  questionId: string;
  kind: 'mcq' | 'numeric';
  stem: string;
  options: Array<{ key: string; text: string }>;
  figure: { src: string; alt: string } | null;
  answered: boolean;
  correct: boolean | null;
}
