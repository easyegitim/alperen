import 'server-only';
import { callRpc, type RpcClient } from '@/server/practice/rpc';
import { studentDb } from '@/server/practice/client';
import { createSupabaseServerClient } from '@/server/supabase';
import { parseLessonList, parseStaffView, parseStudentLessons, parseStudentView, studentLessonSentence, type LessonRow, type LessonStaffView, type StudentLessonRow } from './shared';

// Ders okumaları: kullanıcının JWT'siyle RPC (list_lessons / lesson_view). Yetkiyi veritabanı verir (eğitmen: bağlı
// olduğu dersler; öğrenci: yalnız öğrenciye görünür yaptığı dersin özeti; veli: hiçbiri).

export type LessonListResult = { ok: true; rows: LessonRow[] } | { ok: false; code: string | null };

export async function loadLessons(db?: RpcClient): Promise<LessonListResult> {
  const r = await callRpc(db ?? (await studentDb()), 'list_lessons', { p_student: null }, parseLessonList);
  return r.ok ? { ok: true, rows: r.data } : { ok: false, code: r.code };
}

export type LessonViewResult = { ok: true; view: LessonStaffView } | { ok: false; code: string | null };

export async function loadLesson(id: string, db?: RpcClient): Promise<LessonViewResult> {
  const r = await callRpc(db ?? (await studentDb()), 'lesson_view', { p_lesson: id }, parseStaffView);
  return r.ok ? { ok: true, view: r.data } : { ok: false, code: r.code };
}

/**
 * Yükleme formunun hedefleri: eğitmenin owner olarak bağlı olduğu öğrencilerin etkin kayıtları (öğrenci adı + ders adı).
 * Ders açmak kanıt yazımıdır (register_lesson → owner); viewer bağlı öğrenci listede yoktur, 5 GB yüklenip sonra
 * reddedilmez. Admin her öğrencinin kaydını görür.
 */
export interface LessonTarget {
  enrollmentId: string;
  studentId: string;
  studentName: string;
  courseTitle: string;
}

export async function listLessonTargets(instructorId: string, opts: { admin?: boolean } = {}): Promise<LessonTarget[]> {
  const supabase = await createSupabaseServerClient();
  const ids = opts.admin
    ? [...new Set(((await supabase.from('enrollments').select('student_id').eq('status', 'active')).data ?? []).map((e) => e.student_id))]
    : [...new Set(((await supabase.from('instructor_links').select('student_id').eq('instructor_id', instructorId).eq('role', 'owner')).data ?? []).map((l) => l.student_id))];
  if (ids.length === 0) return [];
  const [{ data: students }, { data: enrollments }] = await Promise.all([
    supabase.from('students').select('id, profile_id').in('id', ids),
    supabase.from('enrollments').select('id, student_id, course_id').in('student_id', ids).eq('status', 'active'),
  ]);
  const profileIds = (students ?? []).map((s) => s.profile_id).filter((x): x is string => Boolean(x));
  const names = new Map<string, string>();
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', profileIds);
    for (const p of profiles ?? []) if (p.display_name) names.set(p.id, p.display_name);
  }
  const studentName = new Map((students ?? []).map((s) => [s.id, (s.profile_id && names.get(s.profile_id)) || 'Öğrenci']));
  const courseIds = [...new Set((enrollments ?? []).map((e) => e.course_id).filter((x): x is string => Boolean(x)))];
  const titles = new Map<string, string>();
  if (courseIds.length > 0) {
    const { data: courses } = await supabase.from('courses').select('id, title').in('id', courseIds);
    for (const c of courses ?? []) titles.set(c.id, c.title);
  }
  return (enrollments ?? [])
    .filter((e) => e.course_id)
    .map((e) => ({ enrollmentId: e.id, studentId: e.student_id, studentName: studentName.get(e.student_id) ?? 'Öğrenci', courseTitle: titles.get(e.course_id as string) ?? 'Ders' }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'tr') || a.courseTitle.localeCompare(b.courseTitle, 'tr'));
}

export interface StudentLessonItem {
  row: StudentLessonRow;
  sentence: string;
}

/** Gelişim › Dersler: öğrenciye görünür dersler (yeni önce, en çok `limit`) ve her birinin tek cümlesi. Okunamazsa boş. */
export async function loadStudentLessons(limit = 5, db?: RpcClient): Promise<{ items: StudentLessonItem[]; total: number }> {
  const client = db ?? (await studentDb());
  const list = await callRpc(client, 'list_lessons', { p_student: null }, parseStudentLessons);
  if (!list.ok) return { items: [], total: 0 };
  const rows = list.data.slice(0, limit);
  const items = await Promise.all(
    rows.map(async (row) => {
      const v = await callRpc(client, 'lesson_view', { p_lesson: row.id }, parseStudentView);
      return { row, sentence: studentLessonSentence(v.ok ? v.data : null) };
    }),
  );
  return { items, total: list.data.length };
}
