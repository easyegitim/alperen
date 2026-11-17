import 'server-only';
import { cache } from 'react';
import { createSupabaseServerClient } from '@/server/supabase';
import type { EnrollmentRow } from '@/lib/supabase/types';

export type ActiveEnrollment = Pick<EnrollmentRow, 'id' | 'curriculum_id' | 'course_id' | 'target_exam' | 'exam_date' | 'created_at'>;

export interface StudentContext {
  studentId: string;
  /** En son açılan etkin kayıt (yoksa null: onboarding yarım). */
  enrollment: ActiveEnrollment | null;
}

/**
 * Oturumdaki öğrencinin kimliği ve etkin kaydı (RLS: öğrenci kendi satırlarını görür). Yönetici /ogrenci'ye girerse
 * kendi öğrenci satırı yoktur: null döner. İstek başına bir kez çalışır.
 */
export const studentContext = cache(async (profileId: string): Promise<StudentContext | null> => {
  const supabase = await createSupabaseServerClient();
  const { data: st } = await supabase.from('students').select('id').eq('profile_id', profileId).maybeSingle();
  if (!st) return null;
  const { data: enr } = await supabase
    .from('enrollments')
    .select('id, curriculum_id, course_id, target_exam, exam_date, created_at')
    .eq('student_id', st.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);
  return { studentId: st.id, enrollment: enr?.[0] ?? null };
});
