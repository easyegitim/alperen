'use server';

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth';
import { isUuid } from '@/server/practice/rpc';
import { uploadClient } from '@/server/uploads/client';
import { studentDb } from '@/server/practice/client';
import { consumeSuggestion } from '@/server/suggestions/service';
import { examDb } from './client';
import { examPlayHref, examResultHref, examIntroHref } from './routes';
import { examClock, examErrorMessage, finishExam, isClosedCode, recordResponse, startExam } from './rpc';

export type RecordActionResult = { ok: true } | { ok: false; message: string; /** Oturum kapandı ya da süre doldu: yeniden denemek anlamsız. */ closed: boolean };
export type FinishActionResult = { ok: true; href: string } | { ok: false; message: string };
export type CanvasActionResult = { ok: true } | { ok: false; message: string };

/** Giriş ekranı "Başla" / "Devam et": start_exam_session (süren oturum varsa o) → oynatıcı. Hata giriş ekranına kodla döner. */
export async function startExamAction(formData: FormData): Promise<void> {
  const examId = formData.get('exam');
  if (!isUuid(examId)) redirect('/ogrenci');
  if (!(await getCurrentUser())) redirect('/giris');
  const res = await startExam(await examDb(), examId);
  if (!res.ok) redirect(`${examIntroHref(examId)}?hata=${encodeURIComponent(res.code ?? 'OGR-WEB-000')}`);
  // Bugün önerisinden geldiyse oturum açılınca öneri tüketilir (en iyi çaba; hata sınavı engellemez)
  const sug = formData.get('suggestion');
  if (isUuid(sug)) await consumeSuggestion(await studentDb(), sug).catch(() => undefined);
  if (res.data.status !== 'in_progress') redirect(examResultHref(res.data.session_id));
  redirect(examPlayHref(res.data.exam_id, res.data.session_id));
}

/**
 * Saat eşitleme: exam_clock salt okur (yeni oturum açmaz). Yalnız süren oturum için bitiş sınırı ve sunucu saati döner;
 * kapalı ya da başka bir oturumun yanıtı yok sayılır.
 */
export async function syncExamClockAction(sessionId: string): Promise<{ deadlineAt: string | null; serverNow: string } | null> {
  if (!isUuid(sessionId) || !(await getCurrentUser())) return null;
  const res = await examClock(await examDb(), sessionId);
  if (!res.ok || res.data.session_id !== sessionId || res.data.status !== 'in_progress') return null;
  return { deadlineAt: res.data.deadline_at ?? null, serverNow: res.data.server_now };
}

/** Oynatıcıdan tek soru yazımı: record_exam_response (cevabın tamamı; ağ hatası istemcide kuyrukta kalır). */
export async function recordExamResponseAction(input: {
  sessionId: string;
  questionId: string;
  answer: string | null;
  flagged: boolean;
  timeSpentSec: number | null;
  workUploadIds?: string[];
}): Promise<RecordActionResult> {
  if (!isUuid(input?.sessionId) || !isUuid(input?.questionId)) return { ok: false, message: examErrorMessage('OGR-EXAM-001'), closed: false };
  if (!(await getCurrentUser())) return { ok: false, message: examErrorMessage('OGR-AUTH-001'), closed: false };
  const work = Array.isArray(input.workUploadIds) ? input.workUploadIds.filter(isUuid).slice(0, 4) : undefined;
  const res = await recordResponse(await examDb(), input.sessionId, {
    questionId: input.questionId,
    answer: typeof input.answer === 'string' ? input.answer : null,
    flagged: Boolean(input.flagged),
    timeSpentSec: input.timeSpentSec ?? null,
    workUploadIds: work,
  });
  if (!res.ok) return { ok: false, message: examErrorMessage(res.code), closed: isClosedCode(res.code) };
  return { ok: true };
}

/** Bitir: finish_exam_session (notlama + teşhis işleri) → Sonuç ekranı. Tekrar çağrı güvenlidir. */
export async function finishExamAction(sessionId: string): Promise<FinishActionResult> {
  if (!isUuid(sessionId)) return { ok: false, message: examErrorMessage('OGR-EXAM-001') };
  if (!(await getCurrentUser())) return { ok: false, message: examErrorMessage('OGR-AUTH-001') };
  const res = await finishExam(await examDb(), sessionId);
  if (!res.ok) return { ok: false, message: examErrorMessage(res.code) };
  return { ok: true, href: examResultHref(sessionId) };
}

/**
 * Karalama tuvali PNG'si tarayıcıdan kendi klasörüne yüklendikten sonra uploads satırını yazar (kind='canvas';
 * RLS uploads_insert_own). Yol '<kullanıcı>/<kimlik>.png' olmalıdır.
 */
export async function registerCanvasUpload(input: { id: string; path: string; bytes: number; width: number; height: number }): Promise<CanvasActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: examErrorMessage('OGR-AUTH-001') };
  const { id, path, bytes, width, height } = input ?? ({} as typeof input);
  if (!isUuid(id) || path !== `${user.id}/${id}.png`) return { ok: false, message: 'Karalama kaydedilemedi.' };
  if (![bytes, width, height].every((n) => Number.isInteger(n) && n > 0 && n < 50_000_000)) return { ok: false, message: 'Karalama kaydedilemedi.' };
  const supabase = await uploadClient();
  const st = await supabase.from('students').select('id').eq('profile_id', user.id).maybeSingle();
  if (st.error || !st.data) return { ok: false, message: 'Öğrenci kaydın bulunamadı.' };
  const ins = await supabase.from('uploads').insert({ id, owner_id: user.id, student_id: st.data.id, kind: 'canvas', storage_path: path, mime: 'image/png', bytes, width, height });
  // 23505: aynı karalama yeniden gönderildi
  if (ins.error && ins.error.code !== '23505') return { ok: false, message: 'Karalama kaydedilemedi. Bağlantını kontrol edip yeniden dene.' };
  return { ok: true };
}
