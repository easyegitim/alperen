// exam_session_view yanıtı (supabase/migrations/0030_exam_pipeline.sql). Cevap anahtarı hiçbir alanda yoktur; telifli
// sınavda soru metni de yoktur. Ayrıştırma toleranslıdır: bilinmeyen alanlar atılır, eksik listeler boş sayılır.
import { z } from 'zod';

const num = z.coerce.number();

const summarySchema = z.object({
  total: num,
  correct: num,
  wrong: num,
  blank: num,
  unfinished: num.default(0),
  ungraded: num.default(0),
  net: num,
  unverified_keys: num.default(0),
  weakest: z.object({ skill_id: z.string(), name: z.string() }).nullable().optional(),
  top_cause: z.string().nullable().optional(),
  one_line: z.string().nullable().optional(),
});

const sectionSchema = z.object({
  section: z.string(),
  title: z.string(),
  total: num,
  correct: num,
  wrong: num,
  blank: num,
  unfinished: num.default(0),
  net: num,
});

const heatSchema = z.object({
  skill_id: z.string(),
  name: z.string(),
  total: num,
  correct: num,
  wrong: num,
  blank: num,
  band: z.enum(['low', 'mid', 'high']),
});

export const ITEM_STATES = ['needs_input', 'pending', 'diagnosed', 'reason_given'] as const;
export type ItemState = (typeof ITEM_STATES)[number];

const itemSchema = z.object({
  response_id: z.string(),
  exam_question_id: z.string().optional(),
  no: num,
  section: z.string().nullable().optional(),
  outcome: z.enum(['wrong', 'blank', 'unfinished']),
  blank_reason: z.enum(['not_started', 'time']).nullable().optional(),
  solution_analysis_id: z.string().nullable().optional(),
  diagnosis: z.object({ one_line: z.string().nullable().optional() }).passthrough().nullable().optional(),
  state: z.enum(ITEM_STATES),
});

const progressSchema = z
  .object({
    stage: z.string().optional(),
    pages_total: num.optional(),
    pages_done: num.optional(),
    error: z.string().optional(),
  })
  .passthrough();

const reportSchema = z.object({ id: z.string(), status: z.string(), pdf_path: z.string().nullable().optional() });

export const examSessionViewSchema = z.object({
  session_id: z.string(),
  exam_id: z.string(),
  title: z.string(),
  mode: z.string(),
  status: z.string(),
  pending: z.boolean(),
  progress: progressSchema.nullable().optional(),
  is_copyrighted: z.boolean().optional(),
  answer_key_source: z.string().nullable().optional(),
  report: reportSchema.nullable().optional(),
  summary: summarySchema.nullable().optional(),
  sections: z.array(sectionSchema).default([]),
  heatmap: z.array(heatSchema).default([]),
  items: z.array(itemSchema).default([]),
  items_hidden: z.boolean().default(false),
});

export type ExamSessionView = z.infer<typeof examSessionViewSchema>;
export type ExamSummary = z.infer<typeof summarySchema>;
export type ExamSection = z.infer<typeof sectionSchema>;
export type ExamHeatCell = z.infer<typeof heatSchema>;
export type ExamResultItem = z.infer<typeof itemSchema>;
export type ExamProgress = z.infer<typeof progressSchema>;

export const parseExamSessionView = (raw: unknown): ExamSessionView => examSessionViewSchema.parse(raw);
