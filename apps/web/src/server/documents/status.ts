// Belge durum metinleri (saf; test/documents-request.test.ts). Öğrenci tarafında yalnız kelime: Hazırlanıyor ·
// İncelemede · Hazır (+ hata). Sayı, yüzde, aşama adı yok.
import type { MyDocument, RequestKind } from './types';

export type StatusWord = 'Hazırlanıyor' | 'İncelemede' | 'Hazır' | 'Hazırlanamadı';
export type Phase = 'working' | 'review' | 'ready' | 'failed';

/** İstek durumu (document_requests.status) → evre. */
export function phaseOf(status: string): Phase {
  switch (status) {
    case 'ready':
    case 'published':
    case 'rendered':
      return 'ready';
    case 'review':
      return 'review';
    case 'failed':
      return 'failed';
    default:
      return 'working';
  }
}

export const isDone = (status: string): boolean => phaseOf(status) === 'ready' || phaseOf(status) === 'failed';

export function statusWord(status: string): StatusWord {
  const p = phaseOf(status);
  return p === 'ready' ? 'Hazır' : p === 'review' ? 'İncelemede' : p === 'failed' ? 'Hazırlanamadı' : 'Hazırlanıyor';
}

const KIND_NAMES: Record<RequestKind, string> = { notes: 'Notun', mock_exam: 'Denemen', question_set: 'Soruların' };

/** Sohbetteki ince durum kartının tek satırı. */
export function chatCardLine(kind: RequestKind, status: string): string {
  switch (phaseOf(status)) {
    case 'ready':
      return `${KIND_NAMES[kind]} hazır`;
    case 'review':
      return 'Hocan inceliyor; onaylayınca Bugün’de görürsün';
    case 'failed':
      return 'Hazırlayamadım. Koça yeniden sorabilirsin';
    default:
      return 'Hazırlıyorum… Bugün’de görürsün';
  }
}

/** Belgelerim satırı için kelime: belgenin kendi durumu ile isteğin durumundan en ileri olanı. */
export function documentStatus(d: Pick<MyDocument, 'status' | 'request_status' | 'pdf_path'>): StatusWord {
  if (d.status === 'rendered' || d.status === 'published') return d.pdf_path ? 'Hazır' : 'Hazırlanıyor';
  if (d.status === 'failed' || d.request_status === 'failed') return 'Hazırlanamadı';
  if (d.status === 'review' || d.request_status === 'review') return 'İncelemede';
  return 'Hazırlanıyor';
}

/** Modelin araç sonucu: öğrenciye ne söyleyeceği (belge içeriği değil). */
export function toolReply(kind: RequestKind, reused: boolean): string {
  const what = kind === 'notes' ? 'Notunu' : kind === 'mock_exam' ? 'Denemeni' : 'Sorularını';
  return `${what} hazırlatmaya başladım${reused ? ' (bu istek zaten alınmıştı)' : ''}. Hazır olunca Bugün’de kartı çıkar. Öğrenciye tek cümleyle bunu söyle; belgenin içeriğini yazma.`;
}

/** request_document hata kodu → modele (ve oradan öğrenciye) söylenecek iletiler. */
export function toolError(code: string | null): string {
  switch (code) {
    case 'OGR-DOC-004':
      return 'Bugünkü belge sınırı doldu. Öğrenciye yarın yeniden isteyebileceğini söyle.';
    case 'OGR-DOC-005':
      return 'İstek geçersiz: konu ya da kazanım eksik ya da aralık dışı. Öğrenciye hangi konuyu istediğini tek soruyla sor.';
    case 'OGR-DOC-006':
      return 'Öğrencinin etkin bir dersi yok; önce bir ders seçmesi gerekir. Öğrenciye bunu söyle.';
    default:
      return 'Belge isteği şu an alınamadı. Öğrenciye biraz sonra yeniden denemesini söyle.';
  }
}
