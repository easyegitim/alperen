'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/server/auth';
import { studentDb } from '@/server/practice/client';
import { appErrorCode, isUuid, type RpcError } from '@/server/practice/rpc';

const PATH = '/egitmen/kuyruk';

function statusOf(error: RpcError, fn: string): string {
  const code = appErrorCode(error);
  if (code === 'OGR-AUTH-002') return 'yetki';
  if (code === 'OGR-QUEUE-001') return 'yok';
  console.error(`[kuyruk] ${fn}`, code, error.message);
  return 'hata';
}

/** "Okundu": koç yönlendirmesini kapatır (resolve_instructor_note; kapsam DB'de denetlenir). */
export async function resolveNote(formData: FormData): Promise<void> {
  await requireRole('instructor', 'admin');
  const id = formData.get('id');
  if (!isUuid(id)) redirect(PATH);
  const { error } = await (await studentDb()).rpc('resolve_instructor_note', { p_id: id });
  if (error) redirect(`${PATH}?durum=${statusOf(error, 'resolve_instructor_note')}`);
  revalidatePath(PATH);
  redirect(`${PATH}?durum=okundu`);
}

/** "Onayla ve üret": tavanda duran isteğe tek seferlik muafiyet (approve_spend_capped_request; onay DB'de kaydedilir). */
export async function approveSpendCapped(formData: FormData): Promise<void> {
  await requireRole('instructor', 'admin');
  const id = formData.get('id');
  if (!isUuid(id)) redirect(PATH);
  const { data, error } = await (await studentDb()).rpc('approve_spend_capped_request', { p_kind: 'document', p_id: id });
  if (error) redirect(`${PATH}?durum=${statusOf(error, 'approve_spend_capped_request')}`);
  revalidatePath(PATH);
  const already = !!data && typeof data === 'object' && (data as { already?: unknown }).already === true;
  redirect(`${PATH}?durum=${already ? 'zaten' : 'onaylandi'}`);
}
