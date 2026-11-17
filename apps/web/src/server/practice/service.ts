// Alıştırma RPC sarmalayıcıları (istemci parametreyle gelir: sunucuda kullanıcının JWT'li supabase-js istemcisi,
// canlı testte gerçek Postgres). Notlama, BKT ve iş kuyruğu tamamen veritabanındadır (0021_practice.sql).
import { callRpc, type RpcClient, type RpcResult } from './rpc';
import { parseAnswerResult, parseFinishSummary, parsePracticeSet, type AnswerResult, type FinishSummary, type PracticeSet } from './types';

/** Bugün kartından: öneri başlatılır, aynı öneri ikinci kez aynı seti döner. */
export function startFromSuggestion(db: RpcClient, suggestionId: string): Promise<RpcResult<PracticeSet>> {
  return callRpc(db, 'start_practice', { p_suggestion: suggestionId }, parsePracticeSet);
}

/** Öneri yokken ("İlk testine başla"): kayıt üzerinden; hedef boşsa en zayıf iki yaprak. */
export function startForEnrollment(db: RpcClient, enrollmentId: string, opts: { skillIds?: string[]; count?: number } = {}): Promise<RpcResult<PracticeSet>> {
  return callRpc(
    db,
    'start_practice',
    { p_suggestion: null, p_enrollment: enrollmentId, p_skill_ids: opts.skillIds ?? null, p_count: opts.count ?? null },
    parsePracticeSet,
  );
}

export function getPracticeSet(db: RpcClient, setId: string): Promise<RpcResult<PracticeSet>> {
  return callRpc(db, 'get_practice_set', { p_set: setId }, parsePracticeSet);
}

export function answerItem(db: RpcClient, input: { setId: string; questionId: string; answer: string; responseMs?: number | null }): Promise<RpcResult<AnswerResult>> {
  const ms = typeof input.responseMs === 'number' && Number.isFinite(input.responseMs) ? Math.max(0, Math.min(3_600_000, Math.round(input.responseMs))) : null;
  return callRpc(db, 'answer_practice_item', { p_set: input.setId, p_question: input.questionId, p_answer: input.answer, p_response_ms: ms }, parseAnswerResult);
}

export function finishPractice(db: RpcClient, setId: string): Promise<RpcResult<FinishSummary>> {
  return callRpc(db, 'finish_practice', { p_set: setId }, parseFinishSummary);
}

/** Set sonuç ekranına hazır mı: bitmiş ya da terk edilmiş ve özeti var. */
export function isClosed(set: PracticeSet): boolean {
  return (set.status === 'finished' || set.status === 'abandoned') && set.summary != null;
}
