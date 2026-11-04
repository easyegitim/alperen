// list_my_documents yanıtı (supabase/migrations/0032_documents.sql). Cevap anahtarı belgesi hiç dönmez.
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
  created_at: z.string(),
});
export type MyDocument = z.infer<typeof documentSchema>;

export const documentListSchema = z.object({ documents: z.array(documentSchema).default([]) });
export const parseDocumentList = (raw: unknown): MyDocument[] => documentListSchema.parse(raw).documents;
