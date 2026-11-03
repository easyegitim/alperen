import 'server-only';
import type { UploadClient } from './client';
import { parseSubmitInput, resultHref, type UploadKind } from './shared';

/** `stale`: sayfaların bir kısmı başka bir gönderime ait (OGR-UPL-003); istemci yeni sayfa anahtarlarıyla yeniden gönderir. */
export type SubmitResult = { ok: true; href: string; uploadIds: string[]; kind: UploadKind } | { ok: false; error: string; stale?: true };

/** RPC/PostgREST hata kodu → öğrenciye tek cümle. */
export function submitErrorMessage(err: { code?: string | null; message?: string | null } | null | undefined): string {
  const msg = err?.message ?? '';
  if (err?.code === 'PGRST202' || err?.code === '42883') return 'Yükleme şu an alınamıyor. Biraz sonra yeniden dene.';
  if (/OGR-UPL-004/.test(msg)) return 'Önce bir ders seçmen gerekiyor; sonra yeniden yükleyebilirsin.';
  if (/OGR-UPL-003/.test(msg)) return 'Bu sayfaların bir kısmı önceki gönderiminde. Gönder’e yeniden basarsan yeni gönderim olarak alırım.';
  if (/OGR-UPL-002/.test(msg)) return 'Sayfalar bulunamadı. Yeniden seçip gönder.';
  if (/OGR-AUTH|42501/.test(msg) || err?.code === '42501') return 'Bu yükleme için oturumun uygun değil. Yeniden giriş yap.';
  return 'Gönderilemedi. Bağlantını kontrol edip yeniden dene.';
}

/**
 * Sayfalar Storage'a yüklendikten sonra (tarayıcı, kendi klasörüne): uploads satırları (RLS uploads_insert_own) +
 * submit_upload RPC'si (doğrular, 'processing' yapar, upload.intake işini aynı işlemde kuyruğa atar).
 * Kullanıcının JWT'siyle çalışır; service_role kullanılmaz.
 */
export async function submitUploadsWith(supabase: UploadClient, user: { id: string }, raw: unknown): Promise<SubmitResult> {
  const parsed = parseSubmitInput(raw, user.id);
  if (!parsed.ok) return parsed;
  const { kind, files } = parsed.value;

  const st = await supabase.from('students').select('id').eq('profile_id', user.id).maybeSingle();
  if (st.error || !st.data) return { ok: false, error: 'Öğrenci kaydın bulunamadı.' };
  const studentId = st.data.id;

  const rows = files.map((f) => ({
    id: f.id,
    owner_id: user.id,
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
  const ins = await supabase.from('uploads').insert(rows);
  // 23505: aynı gönderim yeniden denendi (satırlar zaten var) — RPC durumu yine denetler
  if (ins.error && ins.error.code !== '23505') return { ok: false, error: submitErrorMessage(ins.error) };

  const uploadIds = files.map((f) => f.id);
  const rpc = await supabase.rpc('submit_upload', { p_upload_ids: uploadIds, p_kind: kind });
  if (rpc.error) return { ok: false, error: submitErrorMessage(rpc.error), ...(/OGR-UPL-003/.test(rpc.error.message ?? '') ? { stale: true as const } : {}) };
  return { ok: true, href: resultHref(uploadIds[0]!, kind), uploadIds, kind };
}
