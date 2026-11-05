'use server';

import { revalidatePath } from 'next/cache';
import { PARENT_COPY, isReportKind, type ReportKind } from '@/lib/parent';
import { requireRole } from '@/server/auth';
import { parentChildren, parentDb } from '@/server/parent/children';
import { askReport, loadSummary, markRead, setEmailForAll, setRule } from '@/server/parent/rpc';
import { isUuid } from '@/server/practice/rpc';

export interface ReportState {
  ok?: boolean;
  message?: string;
}

/** "Rapor iste" (Özet): tür çipi + (konu için) kısa metin. Deneme raporu için oturumu sunucu bulur (istemciye güvenilmez). */
export async function requestReportAction(studentId: string, kind: ReportKind, topic: string | null): Promise<ReportState> {
  const { user } = await requireRole('parent');
  if (!isUuid(studentId) || !isReportKind(kind)) return { ok: false, message: PARENT_COPY.reportFailed };
  const children = await parentChildren(user.id);
  if (!children.some((c) => c.id === studentId)) return { ok: false, message: PARENT_COPY.reportFailed };
  const db = await parentDb();
  let sessionId: string | null = null;
  if (kind === 'exam') {
    const summary = await loadSummary(db, studentId);
    sessionId = summary.ok ? (summary.data.lastExam?.sessionId ?? null) : null;
  }
  const out = await askReport(db, studentId, { kind, sessionId, topic });
  return { ok: out.ok, message: out.message };
}

/** Bildirimi okundu işaretler (Özet kartındaki "Okudum"); yalnız geçerli bir bildirim kimliği kabul edilir. */
export async function markNotificationRead(formData: FormData): Promise<void> {
  await requireRole('parent');
  const raw = formData.get('id');
  // Geçersiz ya da eksik kimlik: hiçbir şey yapma (mark_notification_read(null) bütün kutuyu okundu yapar).
  if (!isUuid(raw)) return;
  await markRead(await parentDb(), raw);
  revalidatePath('/veli');
}

/** "E-postayla da gönder" (Bildirimler sayfası): bütün veli kurallarının kanallarına e-posta eklenir ya da çıkarılır. */
export async function toggleEmail(on: boolean): Promise<{ ok: boolean }> {
  await requireRole('parent');
  const ok = await setEmailForAll(await parentDb(), on);
  if (ok) revalidatePath('/veli/bildirimler');
  return { ok };
}

/** Bildirim kuralı anahtarı (Bildirimler sayfası). */
export async function toggleRule(kind: string, enabled: boolean): Promise<{ ok: boolean }> {
  await requireRole('parent');
  const res = await setRule(await parentDb(), kind, enabled);
  if (res.ok) revalidatePath('/veli/bildirimler');
  return { ok: res.ok };
}
