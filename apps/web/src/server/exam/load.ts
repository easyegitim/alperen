import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase';
import { examItems, type QuestionRow, type UploadRef } from './present';
import type { ExamItem } from './types';

// Sayfa verisi: oturum satırı, sınav özeti ve sorular. Tablo ve görünümler src/lib/supabase/types.ts'te tiplenmediğinden
// yapısal bir okuyucu arayüzüyle okunur (kullanıcının JWT'si; RLS geçerli).

interface ReadResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}
interface Query<T> extends PromiseLike<ReadResult<T[]>> {
  eq(col: string, val: string): Query<T>;
  in(col: string, vals: string[]): Query<T>;
  order(col: string): Query<T>;
  limit(n: number): Query<T>;
  maybeSingle(): PromiseLike<ReadResult<T>>;
}
interface Reader {
  from<T>(table: string): { select(cols: string): Query<T> };
  storage: {
    from(bucket: string): {
      createSignedUrls(paths: string[], expiresIn: number): PromiseLike<ReadResult<Array<{ path: string | null; signedUrl: string; error: string | null }>>>;
    };
  };
}

async function reader(): Promise<Reader> {
  return (await createSupabaseServerClient()) as unknown as Reader;
}

export interface SessionRow {
  id: string;
  exam_id: string;
  status: string;
  mode: string;
}

export async function loadSession(sessionId: string): Promise<SessionRow | null> {
  const db = await reader();
  const { data } = await db.from<SessionRow>('exam_sessions').select('id, exam_id, status, mode').eq('id', sessionId).maybeSingle();
  return data ?? null;
}

export interface ExamSummary {
  id: string;
  title: string;
  status: string;
  question_count: number | null;
  duration_min: number | null;
}

export async function loadExam(examId: string): Promise<ExamSummary | null> {
  const db = await reader();
  const { data } = await db.from<ExamSummary>('exams').select('id, title, status, question_count, duration_min').eq('id', examId).maybeSingle();
  return data ?? null;
}

/** Bu sınav için öğrencinin süren (in_progress) uygulama içi oturumu; yoksa null. */
export async function loadOpenSession(examId: string): Promise<SessionRow | null> {
  const db = await reader();
  const { data } = await db.from<SessionRow>('exam_sessions').select('id, exam_id, status, mode').eq('exam_id', examId).eq('status', 'in_progress').eq('mode', 'in_app').order('started_at').limit(1);
  return data?.[0] ?? null;
}

export async function loadQuestions(examId: string): Promise<ExamItem[]> {
  const db = await reader();
  const { data, error } = await db
    .from<QuestionRow>('v_exam_questions_student')
    .select('id, no, section, kind, stem_text, options, is_copyrighted, figure_upload_id, page_upload_id, bbox')
    .eq('exam_id', examId)
    .order('no');
  if (error || !data) throw new Error(`OGR-WEB-002 sorular okunamadı: ${error?.message ?? 'boş'}`);

  const ids = [...new Set(data.flatMap((r) => [r.figure_upload_id, r.page_upload_id]).filter((x): x is string => Boolean(x)))];
  const urls = new Map<string, string>();
  const refs = new Map<string, UploadRef>();
  if (ids.length > 0) {
    const up = await db.from<UploadRef>('uploads').select('id, storage_path, width, height').in('id', ids);
    for (const u of up.data ?? []) refs.set(u.id, u);
    const paths = [...refs.values()].map((u) => u.storage_path);
    if (paths.length > 0) {
      const signed = await db.storage.from('uploads').createSignedUrls(paths, 4 * 3600);
      const byPath = new Map((signed.data ?? []).flatMap((s) => (s.path && s.signedUrl && !s.error ? [[s.path, s.signedUrl] as const] : [])));
      for (const u of refs.values()) {
        const url = byPath.get(u.storage_path);
        if (url) urls.set(u.id, url);
      }
    }
  }
  return examItems(data, urls, refs);
}
