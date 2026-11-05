// list_my_documents yanıtı (supabase/migrations/0032_documents.sql + 0035_document_pipeline.sql) ve belge isteği
// görünümü (0034 document_request_view). Cevap anahtarı belgesi hiç dönmez.
import { z } from 'zod';

export const documentSchema = z.object({
  id: z.string(),
  kind: z.enum(['notes', 'mock_exam', 'report', 'question_set', 'answer_key']),
  title: z.string(),
  status: z.string(),
  pdf_path: z.string().nullable().optional(),
  student_id: z.string().nullable().optional(),
  course_title: z.string().nullable().optional(),
  scope: z.enum(['course', 'personal']).optional(),
  exam_session_id: z.string().nullable().optional(),
  /** 0035: eğitmen incelemesi gereken belge. */
  review_required: z.boolean().nullish(),
  published_at: z.string().nullish(),
  /** 0035: isteğin durumu (queued | generating | verifying | review | ready | failed). */
  request_id: z.string().nullish(),
  request_status: z.string().nullish(),
  /** 0035: belgeden kurulmuş, çözülebilir uygulama içi sınav ("Çöz"). */
  exam_id: z.string().nullish(),
  created_at: z.string(),
});
export type MyDocument = z.infer<typeof documentSchema>;

export const documentListSchema = z.object({ documents: z.array(documentSchema).default([]) });
export const parseDocumentList = (raw: unknown): MyDocument[] => documentListSchema.parse(raw).documents;

export const REQUEST_KINDS = ['notes', 'mock_exam', 'question_set'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** document_request_view / request_document yanıtı (yalnız ekranın kullandığı alanlar). */
export const requestViewSchema = z.object({
  request_id: z.string(),
  kind: z.enum(REQUEST_KINDS),
  status: z.string(),
  status_line: z.string().nullish(),
  error: z.string().nullish(),
  exam_id: z.string().nullish(),
  reused: z.boolean().nullish(),
  document: z
    .object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      review_required: z.boolean().nullish(),
    })
    .nullish(),
});
export type RequestView = z.infer<typeof requestViewSchema>;
export const parseRequestView = (raw: unknown): RequestView => requestViewSchema.parse(raw);
