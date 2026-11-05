'use server';

import { revalidatePath } from 'next/cache';
import { inviteErrorMessage } from '@/lib/invite-errors';
import { parseInviteToken } from '@/lib/validation';
import { requireRole } from '@/server/auth';
import { createSupabaseServerClient } from '@/server/supabase';

export interface DavetState {
  ok?: boolean;
  error?: string;
}

/** Ek davet kodunu kabul eder (accept_guardian_invite RPC). */
export async function acceptInvite(_prev: DavetState, formData: FormData): Promise<DavetState> {
  await requireRole('parent', 'admin');
  const token = parseInviteToken(formData.get('token'));
  if (!token) return { error: 'Davet kodu "gi_" ile başlar; kodu aynen yapıştırın.' };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('accept_guardian_invite', { p_token: token });
  if (error) return { error: inviteErrorMessage(error.message) };
  revalidatePath('/veli', 'layout');
  return { ok: true };
}
