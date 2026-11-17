// Deneme sonucu RPC sarmalayıcıları (kullanıcının JWT'li istemcisi; RLS ve SECURITY DEFINER denetimleri geçerli).
import { callRpc, type RpcClient, type RpcResult } from '@/server/practice/rpc';
import { parseExamSessionView, type ExamSessionView } from './types';

export function examSessionView(db: RpcClient, sessionId: string): Promise<RpcResult<ExamSessionView>> {
  return callRpc(db, 'exam_session_view', { p_session: sessionId }, parseExamSessionView);
}

const passthrough = (raw: unknown): unknown => raw;

/** "Nereye kadar geldim?": metin ve/veya ≤ 4 fotoğraf (uploads satırları önceden yazılmış, 'stored'). */
export function examHowFar(db: RpcClient, responseId: string, text: string | null, uploadIds: string[]): Promise<RpcResult<unknown>> {
  return callRpc(db, 'exam_how_far', { p_response: responseId, p_text: text && text.trim() !== '' ? text.trim().slice(0, 2000) : null, p_upload_ids: uploadIds.length > 0 ? uploadIds : null }, passthrough);
}

export type BlankReason = 'not_started' | 'time';
export const BLANK_REASONS: readonly BlankReason[] = ['not_started', 'time'];

export function examBlankReason(db: RpcClient, responseId: string, reason: BlankReason): Promise<RpcResult<unknown>> {
  return callRpc(db, 'exam_blank_reason', { p_response: responseId, p_reason: reason }, passthrough);
}

export interface SubmitExamResult {
  exam_id: string;
  session_id: string;
  reused: boolean;
}

function parseSubmit(raw: unknown): SubmitExamResult {
  const r = raw as { exam_id?: unknown; session_id?: unknown; reused?: unknown } | null;
  if (!r || typeof r.exam_id !== 'string' || typeof r.session_id !== 'string') throw new Error('submit_exam_upload yanıtı eksik');
  return { exam_id: r.exam_id, session_id: r.session_id, reused: r.reused === true };
}

/** Okul denemesi sayfalarını gönderir; oturumu açar ve exam.analyse işini kuyruğa atar. */
export function submitExamUpload(db: RpcClient, uploadIds: string[]): Promise<RpcResult<SubmitExamResult>> {
  return callRpc(db, 'submit_exam_upload', { p_upload_ids: uploadIds, p_meta: {} }, parseSubmit);
}
