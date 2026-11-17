// Gelişim ekranının okuduğu tablolar/görünüm: supabase/migrations 0006 (attempts), 0009 (exam_sessions), 0010
// (generated_documents), 0019 (mastery_view), 0004/0025 (curricula) — ELLE türetilmiştir; test/progress.test.ts
// sütunları göç dosyalarıyla karşılaştırır. Ana tipler src/lib/supabase/types.ts'tedir.
import type { Json } from '@/lib/supabase/types';

type Tbl<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };

export type AttemptRow = { id: number; enrollment_id: string; context: 'diagnostic' | 'practice' | 'test'; is_correct: boolean | null; created_at: string };
export type ExamSessionRow = { id: string; enrollment_id: string; status: string; score: Json | null; finished_at: string | null; started_at: string };
export type GeneratedDocumentRow = {
  id: string;
  student_id: string | null;
  course_id: string | null;
  kind: 'notes' | 'mock_exam' | 'report' | 'question_set' | 'answer_key';
  title: string;
  pdf_path: string | null;
  status: 'queued' | 'generating' | 'rendered' | 'review' | 'published' | 'failed';
  created_at: string;
};
export type CurriculumRow = {
  id: string;
  status: string;
  origin: string;
  draft_status: 'queued' | 'researching' | 'drafting' | 'saving' | 'ready' | 'failed' | 'skipped' | null;
  draft_progress: number;
};
export type MasteryViewRow = {
  student_id: string;
  enrollment_id: string;
  skill_id: string;
  skill_name: string;
  parent_id: string | null;
  evidence_count: number;
  p: number | null;
  band: 'low' | 'mid' | 'high' | null;
};

export interface ProgressDatabase {
  public: {
    Tables: {
      attempts: Tbl<AttemptRow>;
      exam_sessions: Tbl<ExamSessionRow>;
      generated_documents: Tbl<GeneratedDocumentRow>;
      curricula: Tbl<CurriculumRow>;
    };
    Views: { mastery_view: { Row: MasteryViewRow; Relationships: [] } };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
