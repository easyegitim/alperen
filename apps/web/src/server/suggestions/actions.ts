'use server';

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth';
import { studentDb } from '@/server/practice/client';
import { isUuid } from '@/server/practice/rpc';
import { startForEnrollment, startFromSuggestion } from '@/server/practice/service';
import { examIntroHref } from '@/server/exam/routes';
import { consumeSuggestion, listToday } from './service';
import { examIdOf, noticeHref, parseSuggestions } from './arrange';
import { studentContext } from './student';

/** Hata Bugün'e kodla döner; ekran tek cümleye çevirir (practiceErrorMessage). */
function back(code: string | null): never {
  redirect(`/ogrenci?hata=${encodeURIComponent(code ?? 'OGR-WEB-000')}`);
}

/** Bugün kartı "Başla": start_practice(öneri) → test ekranı. Öneri test türü değilse yalnız başlatıldı işaretlenir. */
export async function startSuggestion(formData: FormData): Promise<void> {
  const id = formData.get('suggestion');
  if (!isUuid(id)) back('OGR-SUG-001');
  if (!(await getCurrentUser())) redirect('/giris');
  const db = await studentDb();
  // mini_exam: alıştırma seti değil uygulama içi sınav; süre giriş ekranında "Başla"ya basınca başlar
  const today = await listToday(db);
  const hit = today.ok ? today.data.find((s) => s.id === id) : undefined;
  const examId = hit ? examIdOf(hit) : null;
  if (examId) redirect(`${examIntroHref(examId)}?oneri=${id}`);
  const res = await startFromSuggestion(db, id);
  if (!res.ok) back(res.code);
  redirect(`/ogrenci/test/${res.data.set_id}`);
}

/** Belge/yükleme sonucu kartı "Aç": consume_suggestion → hedef ekran. */
export async function openNotice(formData: FormData): Promise<void> {
  const id = formData.get('suggestion');
  if (!isUuid(id)) back('OGR-SUG-001');
  if (!(await getCurrentUser())) redirect('/giris');
  const db = await studentDb();
  const res = await consumeSuggestion(db, id);
  if (!res.ok) back(res.code);
  const [s] = parseSuggestions([{ id: res.data.id, kind: res.data.kind, title: '-', payload: res.data.payload, rank: 0, created_at: new Date().toISOString() }]);
  redirect((s && noticeHref(s)) ?? '/ogrenci');
}

/** Öneri yokken "İlk testine başla": etkin kayıt üzerinden en zayıf iki yaprağa set. */
export async function startFirstPractice(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/giris');
  const ctx = await studentContext(user.id);
  if (!ctx?.enrollment) redirect('/hos-geldin');
  const res = await startForEnrollment(await studentDb(), ctx.enrollment.id);
  if (!res.ok) back(res.code);
  redirect(`/ogrenci/test/${res.data.set_id}`);
}
