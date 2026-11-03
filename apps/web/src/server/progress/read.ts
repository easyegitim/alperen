import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/server/supabase';
import { studentContext } from '@/server/suggestions/student';
import type { CurriculumRow, GeneratedDocumentRow, MasteryViewRow, ProgressDatabase } from './db-types';
import { daysUntil, examDative, lastSevenDays, netOf, topicRows, type DayPoint, type TopicRow } from './present';

export type ProgressClient = SupabaseClient<ProgressDatabase>;

export async function progressClient(): Promise<ProgressClient> {
  return (await createSupabaseServerClient()) as unknown as ProgressClient;
}

export interface ProgressView {
  weekCount: number;
  days: DayPoint[];
  lastNet: number | null;
  daysLeft: number | null;
  /** "YKS’ye" ya da "hedefe". */
  examLabel: string;
  topics: TopicRow[];
  documents: DocumentItem[];
}

export type DocumentItem = Pick<GeneratedDocumentRow, 'id' | 'title' | 'kind' | 'created_at'>;

/** Öğrencinin PDF'i hazır belgeleri (RLS: kişiye özel + kayıtlı olduğu dersin yayımlanmış belgeleri; cevap anahtarı yok). */
export async function listDocuments(db: ProgressClient, studentId: string, limit = 50): Promise<DocumentItem[]> {
  const { data } = await db
    .from('generated_documents')
    .select('id, title, kind, created_at, student_id, status, pdf_path')
    .in('status', ['rendered', 'published'])
    .not('pdf_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? [])
    .filter((d) => d.kind !== 'answer_key' && (d.student_id === studentId || d.student_id === null))
    .map((d) => ({ id: d.id, title: d.title, kind: d.kind, created_at: d.created_at }));
}

export async function listTopics(db: ProgressClient, enrollmentId: string): Promise<TopicRow[]> {
  const { data } = await db.from('mastery_view').select('skill_id, skill_name, band, evidence_count').eq('enrollment_id', enrollmentId);
  return topicRows((data ?? []) as Array<Pick<MasteryViewRow, 'skill_id' | 'skill_name' | 'band' | 'evidence_count'>>);
}

/** Gelişim (S08): bu hafta çözülen soru, son deneme neti, hedefe kalan gün, son 7 gün, konular, belgeler. */
export async function loadProgress(profileId: string, now: Date = new Date()): Promise<ProgressView | null> {
  const ctx = await studentContext(profileId);
  if (!ctx) return null;
  const db = await progressClient();
  const enr = ctx.enrollment;
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [attempts, exam, topics, documents] = await Promise.all([
    enr
      ? db.from('attempts').select('created_at').eq('enrollment_id', enr.id).gte('created_at', since).order('created_at', { ascending: false }).limit(2000)
      : Promise.resolve({ data: [] as Array<{ created_at: string }> }),
    enr
      ? db.from('exam_sessions').select('score, finished_at').eq('enrollment_id', enr.id).eq('status', 'done').order('finished_at', { ascending: false }).limit(1)
      : Promise.resolve({ data: [] as Array<{ score: unknown }> }),
    enr ? listTopics(db, enr.id) : Promise.resolve([] as TopicRow[]),
    listDocuments(db, ctx.studentId, 20),
  ]);
  const days = lastSevenDays((attempts.data ?? []).map((a) => a.created_at), now);
  return {
    weekCount: days.reduce((n, d) => n + d.value, 0),
    days,
    lastNet: netOf(exam.data?.[0]?.score ?? null),
    daysLeft: daysUntil(enr?.exam_date ?? null, now),
    examLabel: examDative(enr?.target_exam ?? null),
    topics,
    documents,
  };
}

/** Onboarding "Hazırlıyorum…": taslak müfredatın durumu (RLS: kendi kaydının müfredatı). */
export async function curriculumDraftState(curriculumId: string): Promise<Pick<CurriculumRow, 'status' | 'draft_status' | 'draft_progress'> | null> {
  const db = await progressClient();
  const { data } = await db.from('curricula').select('status, draft_status, draft_progress').eq('id', curriculumId).maybeSingle();
  return data ?? null;
}
