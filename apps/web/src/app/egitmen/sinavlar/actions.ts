'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { buildKeyDiff, type KeyFormValue } from '@/lib/exam-admin';
import { requireRole } from '@/server/auth';
import { loadExamKeys } from '@/server/exam-admin';
import { studentDb } from '@/server/practice/client';
import { appErrorCode, isUuid } from '@/server/practice/rpc';

const STATUS_BY_CODE: Record<string, string> = {
  'OGR-EXAM-003': 'kilitli',
  'OGR-AUTH-002': 'yetki',
  'OGR-EXAM-004': 'gecersiz',
  'OGR-EXAM-005': 'gecersiz',
};

/**
 * Sayfanın tek "Kaydet"i: formdaki anahtarlar, veritabanındaki güncel anahtarla karşılaştırılır (istemciden gelen eski
 * değere güvenilmez); yalnız değişenler ve onaylanan doğrulanmamışlar set_exam_keys(p_source = 'instructor') ile yazılır.
 */
export async function saveExamKeys(formData: FormData): Promise<void> {
  await requireRole('instructor', 'admin');
  const examId = formData.get('exam');
  if (!isUuid(examId)) redirect('/egitmen/sinavlar');
  const path = `/egitmen/sinavlar/${examId}`;
  const db = await studentDb();
  const current = await loadExamKeys(examId, db);
  if (!current.ok) redirect(`${path}?durum=${current.code === 'OGR-AUTH-002' ? 'yetki' : 'hata'}`);

  const form = new Map<number, KeyFormValue>();
  for (const q of current.data.questions) {
    const v = formData.get(`key-${q.no}`);
    if (typeof v === 'string') form.set(q.no, { value: v, confirmed: formData.get(`ok-${q.no}`) === 'on' });
  }
  const { keys, invalid } = buildKeyDiff(current.data.questions, form);
  if (invalid.length > 0) redirect(`${path}?durum=gecersiz`);
  if (keys.length === 0) redirect(`${path}?durum=degisiklik_yok`);

  const { error } = await db.rpc('set_exam_keys', { p_exam: examId, p_keys: keys, p_source: 'instructor' });
  if (error) {
    const code = appErrorCode(error);
    const status = (code && STATUS_BY_CODE[code]) || 'hata';
    if (status === 'hata') console.error('[sinavlar] set_exam_keys', code, error.message);
    redirect(`${path}?durum=${status}`);
  }
  revalidatePath('/egitmen/sinavlar');
  revalidatePath(path);
  redirect(`${path}?durum=kaydedildi&n=${keys.length}`);
}
