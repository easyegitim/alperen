import 'server-only';
import { createSupabaseServerClient } from '@/server/supabase';
import { verificationLines, reviewWarning, type StepLine } from './review-present';

export interface ReviewItem {
  id: string;
  title: string;
  kind: string;
  scope: 'personal' | 'course';
  courseTitle: string | null;
  createdAt: string;
  /** İmzalı PDF adresi (10 dk); PDF yoksa null. */
  src: string | null;
  steps: StepLine[];
  regenerated: number;
  warning: string | null;
}

interface DocRow {
  id: string;
  title: string;
  kind: string;
  student_id: string | null;
  course_id: string | null;
  pdf_path: string | null;
  verification: unknown;
  created_at: string;
}

type Db = {
  from(t: string): {
    select(c: string): {
      eq(c: string, v: string): { order(c: string, o: { ascending: boolean }): { limit(n: number): PromiseLike<{ data: unknown[] | null }> } };
      in(c: string, v: string[]): PromiseLike<{ data: unknown[] | null }>;
    };
  };
  storage: { from(b: string): { createSignedUrls(paths: string[], s: number): PromiseLike<{ data: { path: string | null; signedUrl: string }[] | null }> } };
};

/** İnceleme bekleyen belgeler (RLS: yalnız personel görür; admin hepsini, eğitmen kendi öğrencilerini/derslerini). */
export async function listReviewQueue(limit = 50): Promise<ReviewItem[]> {
  const db = (await createSupabaseServerClient()) as unknown as Db;
  const { data } = await db
    .from('generated_documents')
    .select('id, title, kind, student_id, course_id, pdf_path, verification, created_at')
    .eq('status', 'review')
    .order('created_at', { ascending: true })
    .limit(limit);
  const docs = (data ?? []) as DocRow[];
  if (docs.length === 0) return [];
  const courseIds = [...new Set(docs.map((d) => d.course_id).filter((x): x is string => Boolean(x)))];
  const courses = courseIds.length > 0 ? ((await db.from('courses').select('id, title').in('id', courseIds)).data ?? []) as { id: string; title: string }[] : [];
  const paths = docs.map((d) => d.pdf_path).filter((p): p is string => Boolean(p));
  const signed = paths.length > 0 ? ((await db.storage.from('documents').createSignedUrls(paths, 600)).data ?? []) : [];
  const byPath = new Map(signed.map((s) => [s.path, s.signedUrl] as const));
  return docs.map((d) => {
    const v = verificationLines(d.verification);
    return {
      id: d.id,
      title: d.title,
      kind: d.kind,
      scope: d.student_id ? 'personal' : 'course',
      courseTitle: courses.find((c) => c.id === d.course_id)?.title ?? null,
      createdAt: d.created_at,
      src: d.pdf_path ? (byPath.get(d.pdf_path) ?? null) : null,
      steps: v.steps,
      regenerated: v.regenerated,
      warning: reviewWarning(v.steps),
    };
  });
}
