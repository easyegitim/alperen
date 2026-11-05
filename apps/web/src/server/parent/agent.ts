/**
 * Veli ajanı turu (PLAN-v2 §10, mockup S10b): koç sohbetiyle aynı altyapı (tur kirası, kademeli geçmiş penceresi,
 * akış olayları, transkriptin kalıcılaştırılması, defter), farklı rota ve araçlar:
 *
 *   rota `parent_chat` (Sonnet 5.5 · low, düşünme kapalı (Sonnet between_tools), akış); system[0] ürün + veli asistanı +
 *   görev (packages/prompts parent_chat), system[1] yok, system[2] çocuğun kısa durumu (context.ts; 5 dk önbellek),
 *   sona tur sistem mesajı ("Bugün …"); araçlar strict ve salt okunurdur, `request_report` rapor isteği açar
 *   (parent_request_report → report.generate). Yanıt kısa (en çok üç cümle) ve somut bir adımla biter (prompt).
 *
 * Kapsam veritabanındadır: depo velinin JWT'siyle yalnız `parent_*` RPC'lerini çağırır; koç sohbeti, soru metni, cevap
 * ve anahtar, ham yüklemeler ve olasılık p hiçbir araçta dönmez (supabase 0043, tests/30_parent_rpcs.sql).
 */
import type { CallResult, Gateway, StreamEvent } from '@ogrenmen/llm';
import { buildHistory, steppedStart, toStored } from '@/server/chat/history';
import type { ParentChatStore, ParentDisplayMessage, ParentTurnRecord, ReportRef, StoredBlock, StoredMessage, TurnClaim } from './types';

export const PARENT_ROUTE = 'parent_chat' as const;
export const PARENT_MAX_TEXT = 2000;

export class ParentChatError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ParentChatError';
  }
}

export interface ParentTurnDeps {
  store: ParentChatStore;
  gateway: Gateway;
  /** system[0] (packages/prompts `loadPrompt('parent_chat')`). */
  product: () => { text: string; version: string } | Promise<{ text: string; version: string }>;
  now?: () => Date;
  /** Her turda gateway çağrısından önce (yalnız sahte LLM'de betik sıraya koymak için). */
  onTurn?: (info: { text: string }) => void;
}

export interface ParentTurnRequest {
  studentId: string;
  /** students.public_ref (defter); bilinmiyorsa null. */
  studentRef: string | null;
  conversationId: string | null;
  text: string;
  /** Yeni sohbet aç. */
  fresh: boolean;
  signal?: AbortSignal;
}

export type ParentChatEvent =
  | { type: 'start'; conversationId: string; userMessageId: number }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'restart' }
  | ({ type: 'report' } & ReportRef)
  | { type: 'done'; messageId: number | null; text: string; refusal: boolean }
  | { type: 'error'; code: string; message: string };

export interface PreparedParentTurn {
  req: ParentTurnRequest;
  conversationId: string;
  summary: string | null;
  summaryUptoMessageId: number | null;
  claim: TurnClaim;
}

const TURN_IN_PROGRESS = 'Önceki sorunuza yanıt hazırlanıyor. Biraz sonra yeniden deneyin.';
const LLM_ERROR = 'Şu an yanıt veremiyorum. Biraz sonra yeniden deneyin.';

/** Doğrulama, sohbet ve tur kirası (akış başlamadan; hatalar 4xx). */
export async function prepareParentTurn(deps: Pick<ParentTurnDeps, 'store'>, req: ParentTurnRequest): Promise<PreparedParentTurn> {
  const text = req.text.trim();
  if (text === '') throw new ParentChatError('empty', 400, 'Bir soru yazın.');
  if (text.length > PARENT_MAX_TEXT) throw new ParentChatError('text_too_long', 400, 'Mesaj çok uzun. Daha kısa yazmayı deneyin.');
  let conversationId = req.conversationId;
  let summary: string | null = null;
  let upto: number | null = null;
  if (conversationId) {
    const h = await deps.store.history({ conversationId, studentId: req.studentId, limit: 0 });
    if (!h?.conversation || h.conversation.studentId !== req.studentId) throw new ParentChatError('conversation_not_found', 404, 'Bu sohbet bulunamadı.');
    summary = h.conversation.summary;
    upto = h.conversation.summaryUptoMessageId;
  } else {
    try {
      conversationId = await deps.store.openConversation(req.studentId, req.fresh);
    } catch (err) {
      if ((err as { forbidden?: boolean }).forbidden) throw new ParentChatError('forbidden', 403, 'Bu öğrencinin bilgilerine erişiminiz yok.');
      throw err;
    }
    if (!req.fresh) {
      const h = await deps.store.history({ conversationId, studentId: req.studentId, limit: 0 });
      summary = h?.conversation?.summary ?? null;
      upto = h?.conversation?.summaryUptoMessageId ?? null;
    }
  }
  const claim = await deps.store.claimTurn(conversationId);
  if (!claim) throw new ParentChatError('turn_in_progress', 409, TURN_IN_PROGRESS);
  return { req: { ...req, text }, conversationId, summary, summaryUptoMessageId: upto, claim };
}

/** Turu yürütür; olayları `emit` ile yayımlar. Fırlatmaz (hata `error` olayı). Bitişte tur kirasını bırakır. */
export async function executeParentTurn(deps: ParentTurnDeps, prepared: PreparedParentTurn, emit: (ev: ParentChatEvent) => void): Promise<void> {
  try {
    await runTurn(deps, prepared, emit);
  } finally {
    await prepared.claim.release().catch((err: unknown) => console.error('OGR-PARENT-010 tur kirası bırakılamadı', err));
  }
}

async function runTurn(deps: ParentTurnDeps, prepared: PreparedParentTurn, emit: (ev: ParentChatEvent) => void): Promise<void> {
  const { store, gateway } = deps;
  const { req, conversationId } = prepared;
  const reports: ReportRef[] = [];
  let stored: StoredMessage[] = [];
  let total = 0;
  const content: StoredBlock[] = [{ type: 'text', text: req.text }];
  try {
    const afterId = prepared.summaryUptoMessageId;
    total = (await store.history({ conversationId, studentId: req.studentId, limit: 0, afterId }))?.total ?? 0;
    stored = total > 0 ? ((await store.history({ conversationId, studentId: req.studentId, limit: total - steppedStart(total), afterId }))?.messages ?? []) : [];
    const [userId] = await store.appendMessages(conversationId, [{ role: 'user', content }]);
    emit({ type: 'start', conversationId, userMessageId: userId ?? 0 });
  } catch (err) {
    console.error('OGR-PARENT-009 veli mesajı kaydedilemedi', err);
    emit({ type: 'error', code: 'store_error', message: 'Mesajınız kaydedilemedi. Biraz sonra yeniden deneyin.' });
    return;
  }

  try {
    const history = await buildHistory(stored, prepared.summary, async () => null, { total });
    const product = await deps.product();
    const dossier = await store.childContext(req.studentId);
    const runners = store.toolRunners(req.studentId, (ref) => {
      if (reports.some((r) => r.documentId === ref.documentId)) return;
      reports.push(ref);
      emit({ type: 'report', ...ref });
    });
    const onEvent = (ev: StreamEvent) => {
      if (ev.type === 'text') emit({ type: 'text', text: ev.text });
      else if (ev.type === 'tool_use') emit({ type: 'tool', name: ev.name });
      else if (ev.type === 'restart') emit({ type: 'restart' });
    };
    deps.onTurn?.({ text: req.text });
    const result: CallResult<null> = await gateway.call(PARENT_ROUTE, {
      system: { product: product.text, dossier },
      history,
      user: [{ type: 'text', text: req.text }],
      turn: { now: deps.now?.() ?? new Date() },
      promptVersion: product.version,
      studentRef: req.studentRef,
      ref: { table: 'conversations', id: conversationId },
      tools: { runners },
      onEvent,
      ...(req.signal ? { signal: req.signal } : {}),
    });
    // Transkriptin yeni kısmı: [geçmiş…, veli turu, (tur sistem mesajı), araç turları…, son yanıt].
    const delta = result.transcript.slice(history.length + 1).map(toStored);
    const record: ParentTurnRecord = {
      calls: result.toolCalls.map((c) => ({ name: c.name, isError: c.isError })),
      refusal: result.refusal ? { category: result.refusal.category } : null,
      ...(reports.length > 0 ? { reports } : {}),
      route: PARENT_ROUTE,
      model: result.model ?? null,
    };
    const ledgerId = result.ledgerIds.length > 0 ? (result.ledgerIds[result.ledgerIds.length - 1] ?? null) : null;
    const rows = delta.map((m, i) => (i === delta.length - 1 ? { ...m, llmCallId: ledgerId, toolCalls: record } : m));
    const ids = rows.length > 0 ? await store.appendMessages(conversationId, rows) : [];
    emit({ type: 'done', messageId: ids.length > 0 ? (ids[ids.length - 1] ?? null) : null, text: result.text, refusal: result.refusal !== null });
  } catch (err) {
    console.error('OGR-PARENT-001 veli turu başarısız', err);
    emit({ type: 'error', code: 'llm_error', message: LLM_ERROR });
  }
}

function textOf(blocks: readonly StoredBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => String(b.text))
    .join('\n\n')
    .trim();
}

/** Ekran öğeleri: velinin mesajları ve asistanın son yanıtları (araç turları ve tur sistem mesajları gösterilmez). */
export function toParentDisplay(messages: readonly StoredMessage[]): ParentDisplayMessage[] {
  const out: ParentDisplayMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.content.some((b) => b.type === 'tool_result')) continue;
      const text = textOf(m.content);
      if (text) out.push({ id: `m${m.id}`, from: 'parent', text });
    } else if (m.role === 'assistant') {
      if (m.content.some((b) => b.type === 'tool_use')) continue;
      const text = textOf(m.content);
      if (!text) continue;
      const rec = m.toolCalls as unknown as ParentTurnRecord | null;
      out.push({ id: `m${m.id}`, from: 'assistant', text, ...(rec?.reports?.length ? { reports: rec.reports } : {}) });
    }
  }
  return out;
}

/** Sunucu gönderimli olay: `event: <tür>\ndata: <json>\n\n` (koç akışıyla aynı biçim; components/chat/sse-client.ts). */
export function encodeParentEvent(ev: ParentChatEvent): string {
  const { type, ...data } = ev;
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function parentEventStream(run: (emit: (ev: ParentChatEvent) => void) => Promise<void>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (ev: ParentChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(encodeParentEvent(ev)));
        } catch {
          open = false;
        }
      };
      try {
        await run(emit);
      } finally {
        if (open) {
          open = false;
          try {
            controller.close();
          } catch {
            /* zaten kapalı */
          }
        }
      }
    },
  });
}
