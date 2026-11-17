'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/server/auth';
import { studentDb } from '@/server/practice/client';
import { appErrorCode, callRpc, isUuid } from '@/server/practice/rpc';
import { uploadClient } from '@/server/uploads/client';
import { GENERIC_ERROR, LESSON_ERRORS, THRESHOLD, parseRegister } from '@/server/lessons/shared';

export interface LessonActionResult {
  ok: boolean;
  message: string;
  lessonId?: string;
}

const LIST = '/egitmen/dersler';

function failure(err: { code?: string | null; message: string } | null): LessonActionResult {
  const code = appErrorCode(err);
  return { ok: false, message: (code && LESSON_ERRORS[code]) || GENERIC_ERROR };
}

/**
 * Dosya tarayıcıdan Storage'a TUS ile gittikten sonra: `uploads` satırı (+ varsa transkript satırı; eğitmen arşivi,
 * öğrenciye bağlı değil) ve register_lesson (dersi açar, `lesson.prepare` işini atar). Kullanıcının JWT'siyle.
 */
export async function registerLesson(input: unknown): Promise<LessonActionResult> {
  const { user } = await requireRole('instructor', 'admin');
  const parsed = parseRegister(input, user.id);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  const v = parsed.value;
  const supabase = await uploadClient();
  const rows = [{ id: v.uploadId, owner_id: user.id, student_id: null, kind: v.kind, storage_path: v.path, mime: v.mime, bytes: v.bytes }];
  if (v.transcript) rows.push({ id: v.transcript.uploadId, owner_id: user.id, student_id: null, kind: 'transcript', storage_path: v.transcript.path, mime: v.transcript.mime, bytes: v.transcript.bytes });
  const ins = await supabase.from('uploads').insert(rows);
  // 23505: aynı gönderim yeniden denendi; RPC aynı yüklemeyi aynı derse bağlar
  if (ins.error && ins.error.code !== '23505') return failure(ins.error);
  const meta: Record<string, unknown> = { enrollment_id: v.enrollmentId, auto_apply_threshold: THRESHOLD.default };
  if (v.title) meta.title = v.title;
  if (v.heldAt) meta.held_at = v.heldAt;
  if (v.transcript) meta.transcript_upload_id = v.transcript.uploadId;
  const db = await studentDb();
  const r = await callRpc(db, 'register_lesson', { p_meta: meta, p_upload_id: v.uploadId }, (raw) => raw as { lesson_id?: string; created?: boolean });
  if (!r.ok) return failure(r.error);
  revalidatePath(LIST);
  return { ok: true, message: r.data.created === false ? 'Bu dosya zaten yüklenmişti.' : 'Dersi aldım; yazıya çeviriyorum.', lessonId: r.data.lesson_id };
}

export type ClaimDecision = 'approve' | 'edit' | 'reject';

export async function reviewClaim(lessonId: string, claimId: string, decision: ClaimDecision, edit?: Record<string, unknown>): Promise<LessonActionResult> {
  await requireRole('instructor', 'admin');
  if (!isUuid(lessonId) || !isUuid(claimId) || !['approve', 'edit', 'reject'].includes(decision)) return { ok: false, message: GENERIC_ERROR };
  let p_edit: Record<string, unknown> | null = null;
  if (decision === 'edit') {
    const est = edit?.mastery_estimate;
    const status = edit?.status;
    if (typeof est === 'number' && est >= 0 && est <= 1) p_edit = { mastery_estimate: est };
    else if (status === 'improved' || status === 'still_present') p_edit = { status };
    else return { ok: false, message: GENERIC_ERROR };
  }
  const db = await studentDb();
  const { error } = await db.rpc('review_lesson_claim', { p_claim: claimId, p_decision: decision, p_edit });
  if (error) return failure(error);
  revalidatePath(`${LIST}/${lessonId}`);
  return { ok: true, message: decision === 'approve' ? 'Onayladım.' : decision === 'edit' ? 'Düzeltmeni uyguladım.' : 'Reddettim.' };
}

export async function applyClaims(lessonId: string): Promise<LessonActionResult> {
  await requireRole('instructor', 'admin');
  if (!isUuid(lessonId)) return { ok: false, message: GENERIC_ERROR };
  const db = await studentDb();
  const { data, error } = await db.rpc('apply_lesson_claims', { p_lesson: lessonId });
  if (error) return failure(error);
  revalidatePath(`${LIST}/${lessonId}`);
  const applied = Number((data as { applied?: number } | null)?.applied ?? 0);
  return { ok: true, message: applied > 0 ? `${applied} iddiayı dossier’e işledim.` : 'Eşiğin üstünde işlenecek yeni iddia yok.' };
}

export async function setLessonOptions(lessonId: string, options: { student_visible?: boolean; auto_apply_threshold?: number; title?: string }): Promise<LessonActionResult> {
  await requireRole('instructor', 'admin');
  if (!isUuid(lessonId)) return { ok: false, message: GENERIC_ERROR };
  const p: Record<string, unknown> = {};
  if (typeof options.student_visible === 'boolean') p.student_visible = options.student_visible;
  if (typeof options.auto_apply_threshold === 'number') {
    const t = Math.round(options.auto_apply_threshold * 100) / 100;
    if (!(t >= THRESHOLD.min && t <= THRESHOLD.max)) return { ok: false, message: GENERIC_ERROR };
    p.auto_apply_threshold = t;
  }
  if (typeof options.title === 'string') p.title = options.title.trim().slice(0, 120);
  const db = await studentDb();
  const { error } = await db.rpc('lesson_set_options', { p_lesson: lessonId, p_options: p });
  if (error) return failure(error);
  revalidatePath(`${LIST}/${lessonId}`);
  revalidatePath(LIST);
  return { ok: true, message: 'Kaydettim.' };
}

/** Düşen dersi aynı yüklemelerle yeniden başlatır (retry_lesson; yeniden yükleme gerekmez). */
export async function retryLesson(lessonId: string): Promise<LessonActionResult> {
  await requireRole('instructor', 'admin');
  if (!isUuid(lessonId)) return { ok: false, message: GENERIC_ERROR };
  const db = await studentDb();
  const { error } = await db.rpc('retry_lesson', { p_lesson: lessonId });
  if (error) return failure(error);
  revalidatePath(`${LIST}/${lessonId}`);
  revalidatePath(LIST);
  return { ok: true, message: 'Dersi yeniden işlemeye başladım.' };
}
