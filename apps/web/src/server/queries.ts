import 'server-only';
import { cache } from 'react';
import { createSupabaseServerClient } from './supabase';
import type { Row } from '@/lib/supabase/types';

// Sayfa iskeletlerinin okuduğu küçük sorgular. Hepsi kullanıcının JWT'siyle çalışır: kim ne görür kararını RLS verir
// (supabase/migrations/0018_rls.sql); burada ek süzme yalnız sayfanın doğru kümeyi istemesi içindir.

export type MyStudent = Pick<Row<'students'>, 'id' | 'grade' | 'school' | 'public_ref'>;

/** Oturumdaki öğrencinin students satırı; öğrenci değilse null. */
export const getMyStudent = cache(async (profileId: string): Promise<MyStudent | null> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('students').select('id, grade, school, public_ref').eq('profile_id', profileId).maybeSingle();
  return data ?? null;
});

export type MemoryFile = Pick<Row<'memory_files'>, 'path' | 'content' | 'bytes' | 'updated_at'>;

/** Hafıza dosyaları (RLS: öğrenci kendininkini görür). */
export async function listMemoryFiles(studentId: string): Promise<MemoryFile[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('memory_files').select('path, content, bytes, updated_at').eq('student_id', studentId).order('path');
  return data ?? [];
}

export interface StudentCard {
  id: string;
  name: string;
  grade: string | null;
}

/** Öğrenci kimliklerinden görünen ad + sınıf kartları (profil adı RLS'e göre görünür; yoksa "Öğrenci"). */
async function studentCards(studentIds: string[]): Promise<StudentCard[]> {
  if (studentIds.length === 0) return [];
  const supabase = await createSupabaseServerClient();
  const { data: students } = await supabase.from('students').select('id, profile_id, grade').in('id', studentIds);
  const rows = students ?? [];
  const profileIds = rows.map((s) => s.profile_id).filter((id): id is string => Boolean(id));
  const names = new Map<string, string>();
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', profileIds);
    for (const p of profiles ?? []) if (p.display_name) names.set(p.id, p.display_name);
  }
  return rows.map((s) => ({ id: s.id, name: (s.profile_id && names.get(s.profile_id)) || 'Öğrenci', grade: s.grade }));
}

/** Velinin etkin bağlı çocukları. */
export async function listChildren(parentId: string): Promise<StudentCard[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('guardian_links').select('student_id').eq('parent_id', parentId).eq('status', 'active');
  return studentCards((data ?? []).map((l) => l.student_id));
}

/** Eğitmenin bağlı öğrencileri (instructor_links). */
export async function listInstructorStudents(instructorId: string): Promise<StudentCard[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('instructor_links').select('student_id').eq('instructor_id', instructorId);
  return studentCards([...new Set((data ?? []).map((l) => l.student_id))]);
}

export type NotificationItem = Pick<Row<'notifications'>, 'id' | 'kind' | 'title' | 'body' | 'read_at' | 'created_at'>;

/** Kullanıcının bildirimleri, en yeni önce. */
export async function listNotifications(recipientId: string, limit = 30): Promise<NotificationItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('notifications')
    .select('id, kind, title, body, read_at, created_at')
    .eq('recipient_id', recipientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

export type CourseItem = Pick<Row<'courses'>, 'id' | 'code' | 'title' | 'kind'>;

/** Görülebilen dersler (RLS: courses_select). */
export async function listCourses(): Promise<CourseItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('courses').select('id, code, title, kind').order('title');
  return data ?? [];
}
