import 'server-only';
import type { UploadClient } from './client';
import { isUuid } from './shared';

/**
 * Yüklemenin durumu (bekleme ekranının yoklaması ve sonuç sayfası):
 *   waiting  — teşhis sürüyor (uploads 'stored'/'processing')
 *   ready    — solution_analyses satırı var (analysisId)
 *   received — okul denemesi alındı (uploads 'ready', teşhis yok; analiz P2)
 *   failed   — okunamadı (reason 'reading': model reddetti ya da çıktı okunamadı) ya da işlenemedi (reason
 *              'processing': yapılandırma ya da son denemede de düşen iş). Neden, worker'ın audit 'diagnosis.failed'
 *              satırından öneri motorunun yeniden kurduğu Bugün kartındadır (payload.failure; 48 saat, açılan kart kalır)
 *   missing  — satır yok ya da öğrencinin değil (RLS)
 */
export type UploadState =
  | { state: 'waiting' }
  | { state: 'ready'; analysisId: string; verdict: string }
  | { state: 'received' }
  | { state: 'failed'; reason: 'reading' | 'processing' }
  | { state: 'missing' };

/**
 * Düşen yüklemenin kartı (RLS: öğrencinin kendi kartı; açılmış kart da sayılır). Kart yoksa ya da okunamazsa nötr
 * 'processing' ("şu an işleyemedim, yeniden dener misin"): nedeni bilinmeyen hatada öğrenciye boşuna yeniden fotoğraf
 * çektirilmez.
 */
async function failureReason(supabase: UploadClient, uploadId: string): Promise<'reading' | 'processing'> {
  try {
    const { data } = await supabase
      .from('suggestions')
      .select('payload, created_at')
      .eq('kind', 'upload_result')
      .eq('payload->>upload_id', uploadId)
      .order('created_at', { ascending: false })
      .limit(1);
    const payload = data?.[0]?.payload as { failure?: unknown } | null | undefined;
    return payload?.failure === 'reading' ? 'reading' : 'processing';
  } catch {
    return 'processing';
  }
}

export async function getUploadState(supabase: UploadClient, uploadId: string): Promise<UploadState> {
  if (!isUuid(uploadId)) return { state: 'missing' };
  const [up, sa] = await Promise.all([
    supabase.from('uploads').select('id, status').eq('id', uploadId).maybeSingle(),
    supabase.from('solution_analyses').select('id, verdict, created_at').contains('upload_ids', [uploadId]).order('created_at', { ascending: false }).limit(1),
  ]);
  if (up.error || !up.data) return { state: 'missing' };
  const analysis = sa.data?.[0];
  if (analysis) return { state: 'ready', analysisId: analysis.id, verdict: analysis.verdict };
  if (up.data.status === 'failed') return { state: 'failed', reason: await failureReason(supabase, uploadId) };
  if (up.data.status === 'ready') return { state: 'received' };
  return { state: 'waiting' };
}
