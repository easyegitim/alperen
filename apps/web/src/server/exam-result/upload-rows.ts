import 'server-only';
import type { UploadClient } from '@/server/uploads/client';
import type { SubmittedFile } from '@/server/uploads/shared';

/**
 * Tarayıcının Storage'a yüklediği sayfalar için `uploads` satırları (RLS uploads_insert_own; kullanıcının JWT'si).
 * 23505: aynı gönderim yeniden denendi (satırlar var) — RPC durumu yine denetler.
 */
export async function insertUploadRows(db: UploadClient, ownerId: string, files: SubmittedFile[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const st = await db.from('students').select('id').eq('profile_id', ownerId).maybeSingle();
  const studentId = st.data?.id;
  if (st.error || !studentId) return { ok: false, error: 'Öğrenci kaydın bulunamadı.' };
  const rows = files.map((f) => ({
    id: f.id,
    owner_id: ownerId,
    student_id: studentId,
    kind: f.mime === 'application/pdf' ? ('pdf' as const) : ('photo' as const),
    storage_path: f.path,
    mime: f.mime,
    bytes: f.bytes,
    sha256: f.sha256,
    width: f.width,
    height: f.height,
    pages: f.pages,
  }));
  const ins = await db.from('uploads').insert(rows);
  if (ins.error && ins.error.code !== '23505') return { ok: false, error: 'Sayfalar kaydedilemedi. Bağlantını kontrol edip yeniden dene.' };
  return { ok: true };
}
