'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/server/supabase';

/** Oturumu kapatır ve giriş sayfasına yollar. */
export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/giris');
}
