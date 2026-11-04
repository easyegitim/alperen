// Sınav RPC sarmalayıcıları (istemci parametreyle gelir: sunucuda kullanıcının JWT'li supabase-js istemcisi). Zamanlayıcı,
// süre sınırı, notlama ve anahtar tamamen veritabanındadır (0031_exam_inapp.sql); web yalnız gösterir ve cevabı yazar.
import { callRpc, type RpcClient, type RpcResult } from '@/server/practice/rpc';
import { parseAny, parseExamClock, parsePlayerState, parseUuid, type ExamClockState, type ExamPlayerState } from './types';

/** Sınavın müfredatındaki etkin kayıtla oturum açar; süren oturum varsa onu döner (idempotent). */
export function startExam(db: RpcClient, examId: string): Promise<RpcResult<ExamPlayerState>> {
  return callRpc(db, 'start_exam_session', { p_exam: examId }, parsePlayerState);
}

/**
 * Saat eşitlemesi: exam_clock salt okur (oturum açmaz, kapatmaz). start_exam_session burada kullanılmaz: süresi dolmuş
 * ya da bitmiş bir oturumda yeni deneme oturumu açardı.
 */
export function examClock(db: RpcClient, sessionId: string): Promise<RpcResult<ExamClockState>> {
  return callRpc(db, 'exam_clock', { p_session: sessionId }, parseExamClock);
}

export interface ResponseSnapshot {
  questionId: string;
  /** Her yazımda cevabın tamamı gönderilir: RPC null cevabı temizleme sayar. */
  answer: string | null;
  flagged: boolean;
  timeSpentSec: number | null;
  /** Karalama tuvali yüklemeleri; verilmezse mevcut kalır. */
  workUploadIds?: string[];
}

export function recordResponse(db: RpcClient, sessionId: string, snap: ResponseSnapshot): Promise<RpcResult<string>> {
  const sec = typeof snap.timeSpentSec === 'number' && Number.isFinite(snap.timeSpentSec) ? Math.max(0, Math.min(86_400, Math.round(snap.timeSpentSec))) : null;
  return callRpc(
    db,
    'record_exam_response',
    {
      p_session: sessionId,
      p_exam_question: snap.questionId,
      p_answer: snap.answer && snap.answer.trim() !== '' ? snap.answer.trim().slice(0, 64) : null,
      p_time_spent_sec: sec,
      p_flagged: snap.flagged,
      p_work_upload_ids: snap.workUploadIds && snap.workUploadIds.length > 0 ? snap.workUploadIds : null,
      p_how_far_text: null,
    },
    parseUuid,
  );
}

/** Bitir: bitiş = min(şimdi, sınır); notlar, karalamalı yanlış/boşlar için teşhis işi kuyruğa girer. Tekrar çağrı güvenlidir. */
export function finishExam(db: RpcClient, sessionId: string): Promise<RpcResult<unknown>> {
  return callRpc(db, 'finish_exam_session', { p_session: sessionId }, parseAny);
}

/** Yeniden denenmesi anlamsız hata kodları: oturum kapandı ya da süre doldu. */
export function isClosedCode(code: string | null | undefined): boolean {
  return code === 'OGR-EXAM-003' || code === 'OGR-EXAM-008';
}

/** RPC hata kodu → öğrenciye tek cümle. */
export function examErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case 'OGR-EXAM-001':
      return 'Bu sınav bulunamadı.';
    case 'OGR-EXAM-002':
      return 'Bu sınav senin dersine ait değil.';
    case 'OGR-EXAM-003':
      return 'Bu sınav kapandı; sonucu açıyorum.';
    case 'OGR-EXAM-008':
      return 'Süre doldu; sonucu açıyorum.';
    case 'OGR-AUTH-001':
    case '42501':
      return 'Oturumun bu işlem için uygun değil. Yeniden giriş yap.';
    default:
      return 'Kaydedemedim. Bağlantını kontrol edip yeniden dene.';
  }
}
