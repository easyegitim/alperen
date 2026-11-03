'use server';

import { redirect } from 'next/navigation';
import { inviteErrorMessage } from '@/lib/invite-errors';
import { parseParentProfile, parseStudentProfile, targetExamOf, type FieldErrors, type StudentProfileInput } from '@/lib/validation';
import { getCurrentProfile } from '@/server/auth';
import { hasActiveGuardianLink } from '@/server/queries';
import { createSupabaseServerClient } from '@/server/supabase';

export interface OnboardingState<K extends string = string> {
  errors?: FieldErrors<K>;
  /** Alana bağlı olmayan, tüm formu ilgilendiren hata. */
  formError?: string;
}

/**
 * Öğrenci kurulumu (2 adım: ders/sınav, hedef tarih). Sıra: profil satırı -> sınıf -> enrollments -> en son
 * profiles.onboarded_at; böylece yarım kalan bir yazım kullanıcıyı "kurulmuş" saymaz ve /hos-geldin'e dönülebilir.
 */
export async function completeStudentOnboarding(_prev: OnboardingState<keyof StudentProfileInput>, formData: FormData): Promise<OnboardingState<keyof StudentProfileInput>> {
  const parsed = parseStudentProfile(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const current = await getCurrentProfile();
  if (!current) redirect('/giris');
  const { grade, courseId, examDate } = parsed.value;
  const emailName = current.user.email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim() ?? '';
  const displayName = parsed.value.displayName ?? (current.profile?.display_name?.trim() || (emailName.length >= 2 ? emailName.slice(0, 60) : 'Öğrenci'));
  const supabase = await createSupabaseServerClient();

  if (!current.profile) {
    const { error } = await supabase.from('profiles').insert({ id: current.user.id, role: 'student', display_name: displayName });
    if (error) return { formError: 'Profilin oluşturulamadı. Biraz sonra yeniden dene.' };
  } else if (current.profile.role !== 'student') {
    return { formError: 'Bu hesap öğrenci hesabı değil.' };
  }

  // students satırını profil tetikleyicisi açar; sınıf yalnız kendi satırına yazılabilir (RLS: students_update_self).
  if (grade) {
    const { error: gradeError } = await supabase.from('students').update({ grade }).eq('profile_id', current.user.id);
    if (gradeError) return { formError: 'Sınıfın kaydedilemedi. Biraz sonra yeniden dene.' };
  }

  if (courseId) {
    const { data: course } = await supabase.from('courses').select('id, code, kind, curriculum_id').eq('id', courseId).maybeSingle();
    const { data: student } = await supabase.from('students').select('id').eq('profile_id', current.user.id).maybeSingle();
    if (!course || !course.curriculum_id) return { errors: { courseId: 'Bu ders şu an seçilemiyor. Başka bir ders seç.' } };
    if (!student) return { formError: 'Öğrenci kaydın bulunamadı. Biraz sonra yeniden dene.' };
    const { error: enrollError } = await supabase.from('enrollments').insert({
      student_id: student.id,
      curriculum_id: course.curriculum_id,
      course_id: course.id,
      period_label: String((examDate ?? new Date().toISOString().slice(0, 10)).slice(0, 4)),
      target_exam: targetExamOf(course),
      exam_date: examDate,
    });
    // 23505: aynı ders ve dönem için kayıt zaten var (kurulum yarım kalıp yeniden denendi); sorun değil.
    if (enrollError && enrollError.code !== '23505') return { formError: 'Dersin kaydedilemedi. Biraz sonra yeniden dene.' };
  }

  // Müfredatı eşlenmemiş ders için taslak işi enqueue_job ile yalnız service_role çağırabilir (sunucu işçisi); burada çağrılmaz.
  const { error: profileError } = await supabase.from('profiles').update({ display_name: displayName, onboarded_at: new Date().toISOString() }).eq('id', current.user.id);
  if (profileError) return { formError: 'Bilgilerin kaydedilemedi. Biraz sonra yeniden dene.' };
  redirect('/ogrenci');
}

/** Veli kurulumu: davet kodu accept_guardian_invite RPC'si ile kabul edilir (profil yoksa rol parent açılır). */
export async function completeParentOnboarding(_prev: OnboardingState<'displayName' | 'token'>, formData: FormData): Promise<OnboardingState<'displayName' | 'token'>> {
  const current = await getCurrentProfile();
  if (!current) redirect('/giris');
  // Davet daha önce kabul edilmiş (rol parent + etkin bağ) ama ad/onboarded_at yazılamamışsa kod artık kullanılmış olur
  // (OGR-INV-001); bu durumda kod aranmaz ve RPC atlanır. Karar sunucuda verilir, forma güvenilmez.
  const alreadyLinked = current.profile?.role === 'parent' && (await hasActiveGuardianLink(current.user.id));
  const parsed = parseParentProfile(formData, { tokenOptional: alreadyLinked });
  if (!parsed.ok) return { errors: parsed.errors };
  const { displayName, token } = parsed.value;
  const supabase = await createSupabaseServerClient();

  if (token) {
    const { error: rpcError } = await supabase.rpc('accept_guardian_invite', { p_token: token });
    if (rpcError) return { errors: { token: inviteErrorMessage(rpcError.message) } };
  }

  const { error: profileError } = await supabase.from('profiles').update({ display_name: displayName, onboarded_at: new Date().toISOString() }).eq('id', current.user.id);
  if (profileError) return { formError: 'Davetin kabul edildi ama adın kaydedilemedi. Aynı sayfadan yalnız adını yazıp yeniden dene.' };
  redirect('/veli');
}
