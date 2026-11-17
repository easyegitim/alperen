'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentProfile } from '@/server/auth';
import { callRpc, type RpcClient } from '@/server/practice/rpc';
import { createSupabaseServerClient } from '@/server/supabase';
import { correctionError, parseCorrectionInput } from './input';

export type CorrectionActionResult = { ok: true } | { ok: false; error: string };

/**
 * Profil > Hafıza "Düzeltme iste": request_memory_correction (0023) satır açar ve memory.correction işini kuyruğa
 * atar; worker koç hafızasını `correction` politikasıyla düzenler. Öğrencinin JWT'siyle çalışır (RPC kendisi denetler).
 */
export async function requestMemoryCorrection(input: unknown): Promise<CorrectionActionResult> {
  const parsed = parseCorrectionInput(input);
  if (!parsed.ok) return parsed;
  const current = await getCurrentProfile();
  if (current?.profile?.role !== 'student') return { ok: false, error: 'Bu işlem yalnız öğrenci hesabıyla yapılır.' };
  const supabase = await createSupabaseServerClient();
  const res = await callRpc(supabase as unknown as RpcClient, 'request_memory_correction', { p_path: parsed.value.path, p_text: parsed.value.text }, (d) => d);
  if (!res.ok) return { ok: false, error: correctionError(res.code) };
  revalidatePath('/ogrenci/profil/hafiza');
  return { ok: true };
}
