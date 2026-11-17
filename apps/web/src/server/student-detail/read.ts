import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from '@/lib/supabase/types';
import { memorySortKey } from '@/lib/memory';
import type { ErrorCause, Verdict } from '@/server/diagnosis/present';
import { daysUntil } from '@/server/progress/present';
import { listMemoryFiles, type MemoryFile } from '@/server/queries';
import { createSupabaseServerClient } from '@/server/supabase';
import { isUuid } from '@/server/uploads/shared';
import {
  diagnosisLines,
  examLines,
  formatDay,
  masterySummary,
  misconceptionLines,
  type DiagnosisLine,
  type ExamLine,
  type MasterySummary,
  type MisconceptionLine,
} from './present';

// Eğitmen dossier'inin okuduğu tablolar (göç 0004/0005/0008/0009/0019; ELLE türetilmiştir). Hepsi kullanıcının JWT'siyle
// okunur: RLS (0018_rls.sql) bağlı eğitmene ve admine öğrencinin öğrenme verisini, hafıza dosyalarını açar; yeni RPC yok.
type Tbl<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };
type DetailDatabase = {
  public: {
    Tables: {
      instructor_links: Tbl<{ instructor_id: string; student_id: string }>;
      students: Tbl<{ id: string; profile_id: string | null; grade: string | null }>;
      profiles: Tbl<{ id: string; display_name: string | null }>;
      enrollments: Tbl<{
        id: string;
        student_id: string;
        curriculum_id: string;
        course_id: string | null;
        status: 'active' | 'paused' | 'closed';
        target_exam: string | null;
        exam_date: string | null;
        created_at: string;
      }>;
      courses: Tbl<{ id: string; title: string }>;
      skills: Tbl<{ curriculum_id: string; id: string; name: string }>;
      misconceptions: Tbl<{ id: string; enrollment_id: string; tag: string | null; text_instructor: string; status: string; evidence_count: number; last_seen: string }>;
      solution_analyses: Tbl<{
        id: string;
        enrollment_id: string;
        created_at: string;
        verdict: Verdict;
        failing_step_no: number | null;
        error_cause: ErrorCause | null;
        skill_ids: string[];
        analysis: Json;
      }>;
      exam_sessions: Tbl<{ id: string; exam_id: string; enrollment_id: string; status: string; started_at: string; finished_at: string | null; score: Json | null }>;
      exams: Tbl<{ id: string; title: string }>;
    };
    Views: {
      mastery_view: {
        Row: { enrollment_id: string; skill_id: string; skill_name: string; band: 'low' | 'mid' | 'high' | null; p: number | null; evidence_count: number };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export interface StudentDetail {
  id: string;
  name: string;
  grade: string | null;
  course: string | null;
  targetExam: string | null;
  examDate: string | null;
  daysLeft: number | null;
  mastery: MasterySummary;
  misconceptions: MisconceptionLine[];
  diagnoses: DiagnosisLine[];
  exams: ExamLine[];
  memory: MemoryFile[];
}

/**
 * Bir öğrencinin salt-okunur dossier'i. Eğitmen yalnız instructor_links bağı olan öğrenciyi (app.my_students), admin
 * herkesi görür; bağ yoksa ya da öğrenci satırı RLS ile görünmüyorsa null (sayfa notFound). Kayıt: aktif olan, yoksa en yenisi.
 */
export async function loadStudentDetail(viewer: { id: string; role: string }, studentId: string, now: Date = new Date()): Promise<StudentDetail | null> {
  if (!isUuid(studentId) || (viewer.role !== 'instructor' && viewer.role !== 'admin')) return null;
  const db = (await createSupabaseServerClient()) as unknown as SupabaseClient<DetailDatabase>;
  if (viewer.role === 'instructor') {
    const { data: link } = await db.from('instructor_links').select('student_id').eq('instructor_id', viewer.id).eq('student_id', studentId).limit(1);
    if (!link || link.length === 0) return null;
  }
  const { data: student } = await db.from('students').select('id, profile_id, grade').eq('id', studentId).maybeSingle();
  if (!student) return null;

  const [profile, enrollments, memory] = await Promise.all([
    student.profile_id ? db.from('profiles').select('id, display_name').eq('id', student.profile_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('enrollments').select('id, student_id, curriculum_id, course_id, status, target_exam, exam_date, created_at').eq('student_id', studentId).order('created_at', { ascending: false }),
    listMemoryFiles(studentId),
  ]);
  const enrs = enrollments.data ?? [];
  const enr = enrs.find((e) => e.status === 'active') ?? enrs[0] ?? null;

  const base = {
    id: student.id,
    name: profile.data?.display_name || 'Öğrenci',
    grade: student.grade,
    memory: [...memory].sort((a, b) => memorySortKey(a.path).localeCompare(memorySortKey(b.path))),
  };
  if (!enr) {
    return { ...base, course: null, targetExam: null, examDate: null, daysLeft: null, mastery: masterySummary([]), misconceptions: [], diagnoses: [], exams: [] };
  }

  const [course, mastery, misc, analyses, sessions] = await Promise.all([
    enr.course_id ? db.from('courses').select('id, title').eq('id', enr.course_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('mastery_view').select('enrollment_id, skill_id, skill_name, band, p, evidence_count').eq('enrollment_id', enr.id),
    db.from('misconceptions').select('id, enrollment_id, tag, text_instructor, status, evidence_count, last_seen').eq('enrollment_id', enr.id).eq('status', 'open').order('evidence_count', { ascending: false }).limit(8),
    db.from('solution_analyses').select('id, enrollment_id, created_at, verdict, failing_step_no, error_cause, skill_ids, analysis').eq('enrollment_id', enr.id).order('created_at', { ascending: false }).limit(5),
    db.from('exam_sessions').select('id, exam_id, enrollment_id, status, started_at, finished_at, score').eq('enrollment_id', enr.id).order('started_at', { ascending: false }).limit(3),
  ]);

  const masteryRows = mastery.data ?? [];
  const names = new Map(masteryRows.map((r) => [r.skill_id, r.skill_name]));
  const analysisRows = analyses.data ?? [];
  const missing = [...new Set(analysisRows.flatMap((a) => a.skill_ids))].filter((s) => !names.has(s));
  const sessionRows = sessions.data ?? [];
  const examIds = [...new Set(sessionRows.map((s) => s.exam_id))];
  const [skills, exams] = await Promise.all([
    missing.length > 0 ? db.from('skills').select('curriculum_id, id, name').eq('curriculum_id', enr.curriculum_id).in('id', missing) : Promise.resolve({ data: [] }),
    examIds.length > 0 ? db.from('exams').select('id, title').in('id', examIds) : Promise.resolve({ data: [] }),
  ]);
  for (const s of skills.data ?? []) names.set(s.id, s.name);

  return {
    ...base,
    course: course.data?.title ?? null,
    targetExam: enr.target_exam,
    examDate: enr.exam_date ? formatDay(enr.exam_date) : null,
    daysLeft: daysUntil(enr.exam_date, now),
    mastery: masterySummary(masteryRows),
    misconceptions: misconceptionLines(misc.data ?? []),
    diagnoses: diagnosisLines(analysisRows, names),
    exams: examLines(sessionRows, new Map((exams.data ?? []).map((e) => [e.id, e.title]))),
  };
}
