'use server';

import { redirect } from 'next/navigation';
import { inviteErrorMessage } from '@/lib/invite-errors';
import { parseParentProfile, type FieldErrors } from '@/lib/validation';
import { getCurrentProfile } from '@/server/auth';
import { hasActiveGuardianLink } from '@/server/queries';
import { createSupabaseServerClient } from '@/server/supabase';

export interface OnboardingState<K extends string = string> {
  errors?: FieldErrors<K>;
  /** Alana bağlı olmayan, tüm formu ilgilendiren hata. */
  formError?: string;
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
