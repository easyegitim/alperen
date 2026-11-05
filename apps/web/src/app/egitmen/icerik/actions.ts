'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/server/auth';
import { studentDb } from '@/server/practice/client';
import { appErrorCode, isUuid } from '@/server/practice/rpc';

export interface ReviewResult {
  ok: boolean;
  message: string;
}

const MESSAGES: Record<string, string> = {
  'OGR-AUTH-002': 'Bu belgeyi inceleme yetkin yok.',
  'OGR-DOC-006': 'Bu belge artık incelemede değil.',
  'OGR-DOC-005': 'Not en çok 1000 karakter olabilir.',
};

/** Onayla / Reddet → review_document RPC'si (kullanıcının JWT'siyle; yetkiyi veritabanı verir). */
export async function reviewDocument(documentId: string, decision: 'approve' | 'reject', note: string): Promise<ReviewResult> {
  await requireRole('instructor', 'admin');
  if (!isUuid(documentId) || (decision !== 'approve' && decision !== 'reject')) return { ok: false, message: 'İstek geçersiz.' };
  const db = await studentDb();
  const { error } = await db.rpc('review_document', { p_id: documentId, p_decision: decision, p_note: note.trim() === '' ? null : note.trim().slice(0, 1000) });
  if (error) {
    const code = appErrorCode(error);
    return { ok: false, message: (code && MESSAGES[code]) || 'Kaydedilemedi. Biraz sonra yeniden dene.' };
  }
  revalidatePath('/egitmen/icerik');
  return { ok: true, message: decision === 'approve' ? 'Onaylandı; öğrenciye gönderildi.' : 'Reddedildi.' };
}
