import { callRpc, type RpcClient, type RpcResult } from '@/server/practice/rpc';
import { parseDocumentList, type MyDocument } from './types';

/** Belgelerim: öğrenci kendi + kayıtlı dersinin yayımlanmış belgeleri; veli çocuklarının hazır raporları. */
export function listMyDocuments(db: RpcClient, opts: { kind?: string; studentId?: string; limit?: number } = {}): Promise<RpcResult<MyDocument[]>> {
  return callRpc(db, 'list_my_documents', { p_kind: opts.kind ?? null, p_student: opts.studentId ?? null, p_limit: opts.limit ?? 50 }, parseDocumentList);
}
