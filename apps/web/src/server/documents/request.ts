// Belge isteği RPC sarmalayıcıları (kullanıcının JWT'siyle; supabase/migrations/0034). Koç aracı `request_document`
// ve bekleme ekranı bunları kullanır. server-only değil: testler sahte RpcClient verir.
import type { RequestDocumentInput } from '@ogrenmen/llm';
import { callRpc, type RpcClient, type RpcResult } from '@/server/practice/rpc';
import { parseRequestView, type RequestView } from './types';

/** Araç girdisi → RPC `p_spec` (yalnız verilen alanlar; kapsamı veritabanı doğrular, OGR-DOC-005). */
export function toSpec(input: RequestDocumentInput): Record<string, unknown> {
  const spec: Record<string, unknown> = {};
  if (input.topic?.trim()) spec.topic = input.topic.trim();
  if (input.skill_ids && input.skill_ids.length > 0) spec.skill_ids = input.skill_ids;
  if (input.length) spec.length = input.length;
  if (input.difficulty) spec.difficulty = input.difficulty;
  if (input.include_my_mistakes !== undefined) spec.include_my_mistakes = input.include_my_mistakes;
  if (input.question_count !== undefined) spec.question_count = input.question_count;
  if (input.kind === 'mock_exam' && input.duration_min !== undefined) spec.duration_min = input.duration_min;
  return spec;
}

/** request_document (kaynak chat). `messageId`: öğrencinin bu turdaki mesajı; aynı mesajla ikinci çağrı aynı isteği döner. */
export function requestDocument(db: RpcClient, input: RequestDocumentInput, messageId: number | null): Promise<RpcResult<RequestView>> {
  return callRpc(db, 'request_document', { p_kind: input.kind, p_spec: toSpec(input), p_source: 'chat', p_message_id: messageId }, parseRequestView);
}

export function documentRequestView(db: RpcClient, requestId: string): Promise<RpcResult<RequestView>> {
  return callRpc(db, 'document_request_view', { p_id: requestId }, parseRequestView);
}
