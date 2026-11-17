'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/server/auth';
import { studentDb } from '@/server/practice/client';
import { uploadClient } from '@/server/uploads/client';
import { appErrorCode, isUuid, type RpcClient } from '@/server/practice/rpc';
import { newStyleCode, parseIngest, GENERIC_ERROR, STYLE_ERRORS } from '@/server/styles/shared';

export interface StyleActionResult {
  ok: boolean;
  message: string;
}

const PATH = '/egitmen/soru-tarzlari';

function failure(err: { code?: string | null; message: string } | null): StyleActionResult {
  const code = appErrorCode(err);
  return { ok: false, message: (code && STYLE_ERRORS[code]) || GENERIC_ERROR };
}

async function staffDb(): Promise<RpcClient> {
  await requireRole('instructor', 'admin');
  return studentDb();
}

/**
 * Çıkmış sınav dosyaları tarayıcıdan doğrudan Storage'a gittikten sonra: `uploads` satırları (öğrenciye bağlı değil,
 * eğitmen arşivi) + ingest_exam_source RPC'si (kaynağı açar, style.ingest işini kuyruğa atar). Kullanıcının JWT'siyle.
 */
export async function ingestExamSource(input: unknown): Promise<StyleActionResult & { stale?: true }> {
  const { user } = await requireRole('instructor', 'admin');
  const parsed = parseIngest(input, user.id);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  const { courseId, year, term, files } = parsed.value;
  const supabase = await uploadClient();
  const rows = files.map((f) => ({
    id: f.id,
    owner_id: user.id,
    student_id: null,
    kind: f.mime === 'application/pdf' ? ('pdf' as const) : ('photo' as const),
    storage_path: f.path,
    mime: f.mime,
    bytes: f.bytes,
    sha256: f.sha256,
    width: f.width,
    height: f.height,
    pages: null,
  }));
  const ins = await supabase.from('uploads').insert(rows);
  // 23505: aynı gönderim yeniden denendi; RPC durumu yine denetler
  if (ins.error && ins.error.code !== '23505') return failure(ins.error);
  const db = await studentDb();
  const { data, error } = await db.rpc('ingest_exam_source', { p_course: courseId, p_meta: { year, term }, p_upload_ids: files.map((f) => f.id) });
  if (error) return { ...failure(error), ...(/OGR-UPL-003/.test(error.message) ? { stale: true as const } : {}) };
  const reused = (data as { reused?: boolean } | null)?.reused === true;
  revalidatePath(PATH);
  return { ok: true, message: reused ? 'Bu dosyalar zaten yüklenmişti.' : `${year} sınavını aldım; tarzlara ayırıyorum.` };
}

/** Yeniden adlandır / tanımı düzenle: upsert_question_styles (eğitmen düzenlemesi tarzı etkin yapar, onay izi düşer). */
export async function saveStyle(input: { courseId: string; code: string; name: string; description: string }): Promise<StyleActionResult> {
  const db = await staffDb();
  if (!isUuid(input.courseId) || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,59}$/.test(input.code)) return { ok: false, message: 'İstek geçersiz.' };
  const name = input.name.trim();
  const description = input.description.trim();
  if (name.length < 3 || name.length > 80) return { ok: false, message: 'Ad 3–80 karakter olmalı.' };
  if (description.length > 500) return { ok: false, message: 'Tanım en çok 500 karakter olabilir.' };
  const { error } = await db.rpc('upsert_question_styles', { p_course: input.courseId, p_styles: [{ code: input.code, name, description: description || null, status: 'active' }] });
  if (error) return failure(error);
  revalidatePath(PATH);
  return { ok: true, message: 'Kaydedildi.' };
}

/** Yeni tarz ekle (eğitmen): kod sunucuda üretilir; kazanım ve madde ataması sonradan. */
export async function addStyle(input: { courseId: string; name: string; description: string }): Promise<StyleActionResult> {
  const db = await staffDb();
  if (!isUuid(input.courseId)) return { ok: false, message: 'İstek geçersiz.' };
  const name = input.name.trim();
  const description = input.description.trim();
  if (name.length < 3 || name.length > 80) return { ok: false, message: 'Ad 3–80 karakter olmalı.' };
  if (description.length > 500) return { ok: false, message: 'Tanım en çok 500 karakter olabilir.' };
  const { error } = await db.rpc('upsert_question_styles', { p_course: input.courseId, p_styles: [{ code: newStyleCode(), name, description: description || null, status: 'active' }] });
  if (error) return failure(error);
  revalidatePath(PATH);
  return { ok: true, message: 'Tarz eklendi.' };
}

/** Birleştir: p_merge tarzının her şeyi p_keep'e taşınır, p_merge silinir. */
export async function mergeStyles(keepId: string, mergeId: string): Promise<StyleActionResult> {
  const db = await staffDb();
  if (!isUuid(keepId) || !isUuid(mergeId) || keepId === mergeId) return { ok: false, message: 'Birleştirmek için iki ayrı tarz seç.' };
  const { error } = await db.rpc('merge_styles', { p_keep: keepId, p_merge: mergeId });
  if (error) return failure(error);
  revalidatePath(PATH);
  return { ok: true, message: 'Birleştirildi.' };
}

/** "5 soru üret": style.question_gen işi (üretilenler doğrulanır, bankaya girer; öğrenciye gitmeden önce işçide denetlenir). */
export async function requestStyleQuestions(styleId: string, count = 5): Promise<StyleActionResult> {
  const db = await staffDb();
  if (!isUuid(styleId) || !Number.isInteger(count) || count < 1 || count > 10) return { ok: false, message: 'İstek geçersiz.' };
  const { error } = await db.rpc('request_style_questions', { p_style: styleId, p_count: count });
  if (error) return failure(error);
  return { ok: true, message: `${count} soru üretmeye başladım; hazır olunca soru bankasına girer.` };
}

/** "Önceliği hesapla": compute_priority_plan → bekleyen plan (onaylanana dek öğrenci görmez). */
export async function computePlan(courseId: string): Promise<StyleActionResult> {
  const db = await staffDb();
  if (!isUuid(courseId)) return { ok: false, message: 'İstek geçersiz.' };
  const { error } = await db.rpc('compute_priority_plan', { p_course: courseId });
  if (error) return failure(error);
  revalidatePath(PATH);
  return { ok: true, message: 'Öncelik listesi hazır; onaylayınca öğrenciler görür.' };
}

export async function decidePlan(planId: string, decision: 'approved' | 'retired'): Promise<StyleActionResult> {
  const db = await staffDb();
  if (!isUuid(planId) || (decision !== 'approved' && decision !== 'retired')) return { ok: false, message: 'İstek geçersiz.' };
  const { error } = await db.rpc('approve_priority_plan', { p_plan: planId, p_decision: decision });
  if (error) return failure(error);
  revalidatePath(PATH);
  return { ok: true, message: decision === 'approved' ? 'Onaylandı.' : 'Listeyi kaldırdım.' };
}
