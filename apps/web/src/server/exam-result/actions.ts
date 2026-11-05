'use server';

import { getCurrentProfile } from '@/server/auth';
import { isUuid } from '@/server/practice/rpc';
import { uploadClient } from '@/server/uploads/client';
import { insertUploadRows } from './upload-rows';
import { parseExamSubmit, parseHowFarInput } from './input';
import { examBlankReason, examHowFar, submitExamUpload, BLANK_REASONS, type BlankReason } from './rpc';
import { examHref, howFarError, submitExamError } from './present';

export type ExamActionResult = { ok: true; href: string } | { ok: false; error: string; stale?: true };

async function studentOnly() {
  const current = await getCurrentProfile();
  return current?.profile?.role === 'student' ? current.user : null;
}

/** Yükle ekranı, "Okul denemesi": sayfa satırları + submit_exam_upload → bekleme ekranı. */
export async function submitExam(input: unknown): Promise<ExamActionResult> {
  const user = await studentOnly();
  if (!user) return { ok: false, error: 'Yükleme yalnız öğrenci hesabıyla yapılır.' };
  const parsed = parseExamSubmit(input, user.id);
  if (!parsed.ok) return parsed;
  const db = await uploadClient();
  const ins = await insertUploadRows(db, user.id, parsed.value.files);
  if (!ins.ok) return ins;
  const res = await submitExamUpload(db, parsed.value.files.map((f) => f.id));
  if (!res.ok) return { ok: false, error: submitExamError(res.code), ...(res.code === 'OGR-UPL-003' ? { stale: true as const } : {}) };
  return { ok: true, href: examHref(res.data.session_id) };
}

/** "Nereye kadar geldim?": yazı ve/veya fotoğraf; yanıt sonuç ekranının Detay'ına döner. */
export async function sendHowFar(input: unknown): Promise<ExamActionResult> {
  const user = await studentOnly();
  if (!user) return { ok: false, error: 'Bu işlem yalnız öğrenci hesabıyla yapılır.' };
  const parsed = parseHowFarInput(input, user.id);
  if (!parsed.ok) return parsed;
  const { sessionId, responseId, text, files } = parsed.value;
  const db = await uploadClient();
  if (files.length > 0) {
    const ins = await insertUploadRows(db, user.id, files);
    if (!ins.ok) return ins;
  }
  const res = await examHowFar(db, responseId, text, files.map((f) => f.id));
  if (!res.ok) return { ok: false, error: howFarError(res.code) };
  return { ok: true, href: `${examHref(sessionId)}?detay=1` };
}

/** "Hiç başlayamadım" / "Süre yetmedi". */
export async function sendBlankReason(input: unknown): Promise<ExamActionResult> {
  const user = await studentOnly();
  if (!user) return { ok: false, error: 'Bu işlem yalnız öğrenci hesabıyla yapılır.' };
  const r = input as { sessionId?: unknown; responseId?: unknown; reason?: unknown } | null;
  if (!r || !isUuid(r.sessionId) || !isUuid(r.responseId) || !BLANK_REASONS.includes(r.reason as BlankReason)) return { ok: false, error: 'Seçim okunamadı.' };
  const res = await examBlankReason(await uploadClient(), r.responseId, r.reason as BlankReason);
  if (!res.ok) return { ok: false, error: howFarError(res.code) };
  return { ok: true, href: `${examHref(r.sessionId)}?detay=1` };
}
