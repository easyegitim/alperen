'use server';

import { redirect } from 'next/navigation';
import { getCurrentProfile } from '@/server/auth';
import { callRpc, type RpcClient } from '@/server/practice/rpc';
import { createSupabaseServerClient } from '@/server/supabase';
import { isCourseError, parseCourseText, parseExamDate, parseEnrollResult, onboardingErrorMessage, nextAfterEnroll } from './shared';

export interface OnboardingQuestionState {
  error?: string;
  /** Ders adımına dönülmesi gerekiyorsa 'ders'. */
  step?: 'ders';
}

/**
 * Onboarding tek soru (mockup S01; ders + hedef tarih): profil satırı yoksa öğrenci profili açılır (tetikleyici students satırını yaratır),
 * sonra onboarding_enroll (0022_onboarding.sql) dersi/müfredatı eşler ya da ders + taslak müfredat açıp
 * curriculum.draft işini kuyruğa atar, kaydı ve profiles.onboarded_at'i yazar, suggestions.refresh'i kuyruğa atar.
 * Taslak sürüyorsa "Hazırlıyorum…" ekranına, değilse Bugün'e gidilir.
 */
export async function enrollFromOnboarding(_prev: OnboardingQuestionState, formData: FormData): Promise<OnboardingQuestionState> {
  const text = parseCourseText(formData.get('ders'));
  if (!text.ok) return { error: text.error };
  const date = parseExamDate(formData.get('tarih'), formData.get('atla'));
  if (!date.ok) return { error: date.error };
  const current = await getCurrentProfile();
  if (!current) redirect('/giris');
  const supabase = await createSupabaseServerClient();

  if (!current.profile) {
    const emailName = current.user.email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim() ?? '';
    const displayName = emailName.length >= 2 ? emailName.slice(0, 60) : 'Öğrenci';
    const { error } = await supabase.from('profiles').insert({ id: current.user.id, role: 'student', display_name: displayName });
    // 23505: profil az önce açıldı (çift gönderim); sorun değil
    if (error && error.code !== '23505') return { error: 'Profilin oluşturulamadı. Biraz sonra yeniden dene.' };
  } else if (current.profile.role !== 'student') {
    return { error: 'Bu hesap öğrenci hesabı değil.' };
  }

  const res = await callRpc(supabase as unknown as RpcClient, 'onboarding_enroll', date.value ? { p_course_text: text.value, p_exam_date: date.value } : { p_course_text: text.value }, parseEnrollResult);
  if (!res.ok) return { error: onboardingErrorMessage(res.code), ...(isCourseError(res.code) ? { step: 'ders' as const } : {}) };
  redirect(nextAfterEnroll(res.data));
}
