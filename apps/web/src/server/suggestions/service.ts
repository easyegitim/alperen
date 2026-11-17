// Öneri RPC sarmalayıcıları (0020_suggestions.sql). Yazım yalnız worker'dadır (replace_suggestions); web okur ve
// "Başla"/"Aç" ile başlatıldı işaretler. Öneri yenileme isteği web'den yapılmaz: onboarding_enroll ve finish_practice
// suggestions.refresh işini aynı işlemde kuyruğa atar, gece işi de yeniler.
import { callRpc, type RpcClient, type RpcResult } from '@/server/practice/rpc';
import { parseSuggestions, type Suggestion } from './arrange';

export function listToday(db: RpcClient): Promise<RpcResult<Suggestion[]>> {
  return callRpc(db, 'list_today_suggestions', {}, parseSuggestions);
}

export function consumeSuggestion(db: RpcClient, id: string): Promise<RpcResult<{ id: string; kind: string; payload: Record<string, unknown> }>> {
  return callRpc(db, 'consume_suggestion', { p_id: id }, (raw) => {
    const r = (raw ?? {}) as { id?: unknown; kind?: unknown; payload?: unknown };
    if (typeof r.id !== 'string' || typeof r.kind !== 'string') throw new Error('id/kind yok');
    return { id: r.id, kind: r.kind, payload: r.payload && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : {} };
  });
}
