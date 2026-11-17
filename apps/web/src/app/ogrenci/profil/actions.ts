'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/server/auth';
import { parentDb } from '@/server/parent/children';
import { callRpc, isUuid } from '@/server/practice/rpc';

/** Öğrenci Profil: veli bağını kaldırır (revoke_guardian_link; yetkiyi RPC denetler). */
export async function revokeGuardianLink(linkId: string): Promise<{ ok: boolean }> {
  await requireRole('student', 'admin');
  if (!isUuid(linkId)) return { ok: false };
  const res = await callRpc(await parentDb(), 'revoke_guardian_link', { p_link: linkId }, (raw) => raw);
  if (res.ok) revalidatePath('/ogrenci/profil');
  return { ok: res.ok };
}
