import 'server-only';
import { callRpc, type RpcClient } from '@/server/practice/rpc';
import { studentDb } from '@/server/practice/client';
import { createSupabaseServerClient } from '@/server/supabase';
import { parseLibrary, type LibraryView } from './shared';

// Tarz kütüphanesi okumaları: kullanıcının JWT'siyle RPC (style_library_view / student_style_coverage; yetkiyi
// veritabanı verir). Ders listesi `courses` tablosundan (RLS).

export interface CourseOption {
  id: string;
  title: string;
}

export async function listCourses(): Promise<CourseOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('courses').select('id, title').order('title').limit(100);
  return ((data ?? []) as CourseOption[]).map((c) => ({ id: c.id, title: c.title }));
}

export type LibraryResult = { ok: true; view: LibraryView } | { ok: false; code: string | null };

export async function loadLibrary(courseId: string, db?: RpcClient): Promise<LibraryResult> {
  const client = db ?? (await studentDb());
  const r = await callRpc(client, 'style_library_view', { p_course: courseId }, parseLibrary);
  return r.ok ? { ok: true, view: r.data } : { ok: false, code: r.code };
}

export interface StudentStyleSummary {
  styles: number;
  never_solved: number;
  rows: { styleId: string; name: string; text: string }[];
}

/** Gelişim satırı: kaydın etkin tarzları ve kapsama cümleleri. Okunamazsa (göç yok, yetki) null: satır çizilmez. */
export async function loadStudentStyleSummary(enrollmentId: string, db?: RpcClient): Promise<StudentStyleSummary | null> {
  const client = db ?? (await studentDb());
  const r = await callRpc(client, 'student_style_coverage', { p_enrollment: enrollmentId }, (raw): StudentStyleSummary => {
    const o = raw as { styles?: Array<{ style_id: string; name: string; text: string }>; summary?: { styles: number; never_solved: number } };
    if (!o || !Array.isArray(o.styles) || !o.summary) throw new Error('beklenen biçim yok');
    return {
      styles: Number(o.summary.styles),
      never_solved: Number(o.summary.never_solved),
      rows: o.styles.map((s) => ({ styleId: s.style_id, name: s.name, text: s.text })),
    };
  });
  return r.ok ? r.data : null;
}
