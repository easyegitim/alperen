'use server';

import { redirect } from 'next/navigation';
import { inviteErrorMessage } from '@/lib/invite-errors';
import { parseParentProfile, parseStudentProfile, type FieldErrors, type StudentProfileInput } from '@/lib/validation';
import { getCurrentProfile } from '@/server/auth';
import { createSupabaseServerClient } from '@/server/supabase';

export interface OnboardingState<K extends string = string> {
  errors?: FieldErrors<K>;
  /** Alana bağlı olmayan, tüm formu ilgilendiren hata. */
  formError?: string;
}

/** Öğrenci kurulumu: profil (rol student) + ad + sınıf; hedef kullanıcı üst verisine yazılır (ders seçiminde kayda dönüşür). */
export async function completeStudentOnboarding(_prev: OnboardingState<keyof StudentProfileInput>, formData: FormData): Promise<OnboardingState<keyof StudentProfileInput>> {
  const parsed = parseStudentProfile(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const current = await getCurrentProfile();
  if (!current) redirect('/giris');
  const { displayName, grade, targetExam, goal } = parsed.value;
  const supabase = await createSupabaseServerClient();
  const now = new Date().toISOString();

  if (!current.profile) {
    const { error } = await supabase.from('profiles').insert({ id: current.user.id, role: 'student', display_name: displayName });
    if (error) return { formError: 'Profilin oluşturulamadı. Biraz sonra yeniden dene.' };
  } else if (current.profile.role !== 'student') {
    return { formError: 'Bu hesap öğrenci hesabı değil.' };
  }

  const { error: profileError } = await supabase.from('profiles').update({ display_name: displayName, onboarded_at: now }).eq('id', current.user.id);
  if (profileError) return { formError: 'Bilgilerin kaydedilemedi. Biraz sonra yeniden dene.' };

  // students satırını profil tetikleyicisi açar; sınıf yalnız kendi satırına yazılabilir (RLS: students_update_self).
  const { error: studentError } = await supabase.from('students').update({ grade }).eq('profile_id', current.user.id);
  if (studentError) return { formError: 'Sınıfın kaydedilemedi. Biraz sonra yeniden dene.' };

  // Hedef: ders (müfredat) seçilince enrollments.target_exam/goal'a taşınır; o ana dek kullanıcı üst verisinde durur.
  await supabase.auth.updateUser({ data: { target_exam: targetExam, goal } });
  redirect('/ogrenci');
}

/** Veli kurulumu: davet kodu accept_guardian_invite RPC'si ile kabul edilir (profil yoksa rol parent açılır). */
export async function completeParentOnboarding(_prev: OnboardingState<'displayName' | 'token'>, formData: FormData): Promise<OnboardingState<'displayName' | 'token'>> {
  const parsed = parseParentProfile(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const current = await getCurrentProfile();
  if (!current) redirect('/giris');
  const { displayName, token } = parsed.value;
  const supabase = await createSupabaseServerClient();

  const { error: rpcError } = await supabase.rpc('accept_guardian_invite', { p_token: token });
  if (rpcError) return { errors: { token: inviteErrorMessage(rpcError.message) } };

  const { error: profileError } = await supabase.from('profiles').update({ display_name: displayName, onboarded_at: new Date().toISOString() }).eq('id', current.user.id);
  if (profileError) return { formError: 'Davetin kabul edildi ama adın kaydedilemedi. Sayfayı yenileyip yeniden dene.' };
  redirect('/veli');
}
