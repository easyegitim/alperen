// Yükle → Teşhis ekranlarının okuduğu tablolar ve RPC: supabase/migrations/0005, 0007, 0008, 0011, 0020'den ELLE
// türetilmiştir (ana tipler src/lib/supabase/types.ts başka ekranlarla paylaşılır; bu akışın tipleri burada ayrı durur).
// test/uploads.test.ts sütunları göç dosyalarıyla karşılaştırır.
import type { Json } from '@/lib/supabase/types';

type Tbl<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };

export type UploadRow = {
  id: string;
  owner_id: string;
  student_id: string | null;
  kind: 'photo' | 'pdf' | 'video' | 'audio' | 'transcript' | 'document' | 'canvas';
  storage_path: string;
  mime: string | null;
  bytes: number | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  pages: number | null;
  anthropic_file_id: string | null;
  status: 'stored' | 'processing' | 'ready' | 'failed';
  created_at: string;
};

export type SolutionAnalysisRow = {
  id: string;
  enrollment_id: string;
  upload_ids: string[];
  question_text: string | null;
  student_work_text: string | null;
  analysis: Json;
  verdict: 'correct' | 'wrong' | 'incomplete' | 'unreadable';
  failing_step_no: number | null;
  error_cause: 'concept' | 'procedure' | 'careless' | 'reading' | 'time' | null;
  skill_ids: string[];
  misconception_tags: string[];
  created_at: string;
};

export type DiagnosisEnrollmentRow = { id: string; student_id: string; curriculum_id: string; course_id: string | null; status: string };
export type DiagnosisSkillRow = { curriculum_id: string; id: string; name: string; is_leaf: boolean };
export type DiagnosisMasteryRow = { enrollment_id: string; skill_id: string; p: number; evidence_count: number };
export type DiagnosisTagRow = { tag: string; skill_id: string | null; text_student: string };
export type DiagnosisStudentRow = { id: string; profile_id: string | null };
/** Bugün kartı (0020): düşen yüklemenin kartı payload.failure ('reading' | 'processing') taşır (worker diagnosis.run). */
export type UploadCardRow = { id: string; student_id: string; kind: string; payload: Json; consumed_at: string | null; created_at: string };

export interface UploadDatabase {
  public: {
    Tables: {
      uploads: Tbl<UploadRow>;
      solution_analyses: Tbl<SolutionAnalysisRow>;
      enrollments: Tbl<DiagnosisEnrollmentRow>;
      skills: Tbl<DiagnosisSkillRow>;
      mastery: Tbl<DiagnosisMasteryRow>;
      misconception_tags: Tbl<DiagnosisTagRow>;
      students: Tbl<DiagnosisStudentRow>;
      suggestions: Tbl<UploadCardRow>;
    };
    Views: Record<string, never>;
    Functions: {
      /** 0026: yüklemeleri doğrular, 'processing' yapar, upload.intake'i kuyruğa atar; {enrollment_id, job_id, upload_ids, kind, reused}. */
      submit_upload: { Args: { p_upload_ids: string[]; p_kind: 'own_work' | 'school_exam' }; Returns: Json };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
