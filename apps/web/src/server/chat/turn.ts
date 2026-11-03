/**
 * Bir koç turu (PLAN-v2 §2, §3.3, §5, §6): tur kilidi alınır (aynı sohbette aynı anda tek tur; ikincisi 409) →
 * kullanıcı turu kaydedilir → geçmiş (özet + kademeli ~30 mesaj penceresi, ek bütçesi) kurulur → rota: ipucu/açıkla
 * modunda `coach_chat` (Sonnet 5.5 · medium), "Çözümü göster" modunda `coach_deep` (Opus 5.5 · high); akışlı;
 * system[0] ürün+rol+rota, system[1] ders, system[2] dossier; sona tur sistem mesajı "Bugün … Mod: …" → metin akışı
 * olaylara çevrilir → bitişte transkriptin yeni kısmı (tur sistem mesajı, araç turları, son yanıt) kaydedilir, son
 * mesaja `llm_call_id` ve tur kaydı bağlanır → kilit bırakılır.
 *
 * Mod (`conversations.mode`) yalnız öğrencinin isteğiyle değişir; modelin `record_turn_meta.mode_suggestion`'ı yalnız
 * öneridir (arayüz sorar). Ret (`stop_reason: refusal`) kibar Türkçe iletiyle kapanır; kategori eğitmen yönlendirmesi
 * gerektiriyorsa (ya da koç turu `escalate_to_instructor` ile işaretlediyse) eğitmene not düşülür.
 */
import { CHAT_COPY } from '@/lib/chat';
import type { CallResult, CoachMode, Gateway, StreamEvent, ToolRunners } from '@ogrenmen/llm';
import {
  base64Size,
  buildHistory,
  hydrateBlocks,
  steppedStart,
  toStored,
  TURN_MEDIA_B64,
  uploadBlock,
  uploadIdsOf,
  userContent,
  type BetaContentBlockParam,
  type UploadLoader,
} from './history';
import type { ChatStore, ChatStudent, CoachMode as Mode, ConversationRow, SeedContext, StoredBlock, TurnClaim, TurnMeta, TurnRecord, UploadRow } from './types';

export const MAX_TEXT_CHARS = 4000;
export const MAX_UPLOADS = 4;
export const COACH_ROUTE = 'coach_chat' as const;
export const COACH_DEEP_ROUTE = 'coach_deep' as const;
export type CoachRoute = typeof COACH_ROUTE | typeof COACH_DEEP_ROUTE;

/**
 * Mod → rota (PLAN-v2 §5): "Çözümü göster" tam çözüm/derin açıklama isteğidir → `coach_deep` (Opus 5.5 · high).
 * Önbellek modele bağlıdır; mod değişince ilk istek önbelleği ıskalar. Mod yalnız öğrencinin seçimiyle ve seyrek
 * değiştiği için bu bilerek kabul edilir.
 */
export function coachRouteFor(mode: Mode): CoachRoute {
  return mode === 'solve' ? COACH_DEEP_ROUTE : COACH_ROUTE;
}

/** Ekin isteğe gireceği base64 boyu (Files kimlikliler 0; boyu bilinmeyen en kötü durumla sayılır). */
function mediaCost(u: UploadRow | undefined): number {
  if (!u || u.anthropicFileId) return 0;
  return base64Size(u.bytes ?? TURN_MEDIA_B64);
}

export class ChatError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ChatError';
  }
}

export interface ProductPrompt {
  text: string;
  version: string;
}

export interface TurnDeps {
  store: ChatStore;
  gateway: Gateway;
  /** system[0] metni (packages/prompts `loadPrompt(route)`; rota moda göre). */
  product: (route: CoachRoute) => ProductPrompt | Promise<ProductPrompt>;
  now?: () => Date;
}

export interface TurnRequest {
  student: ChatStudent;
  conversationId: string | null;
  text: string;
  uploadIds: readonly string[];
  /** Öğrencinin seçtiği mod; verilirse sohbetin modu buna ayarlanır. */
  mode: CoachMode | null;
  /** "Koça sor": solution_analyses.id. */
  seedId: string | null;
  signal?: AbortSignal;
}

export type ChatEvent =
  | { type: 'start'; conversationId: string; userMessageId: number; mode: CoachMode }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'restart' }
  | {
      type: 'done';
      messageId: number | null;
      text: string;
      refusal: boolean;
      escalated: boolean;
      modeSuggestion: CoachMode | null;
    }
  | { type: 'error'; code: string; message: string };

export interface PreparedTurn {
  req: TurnRequest;
  conversation: ConversationRow;
  uploads: UploadRow[];
  seed: SeedContext | null;
  /** Tur kilidi; `executeTurn` bitişte bırakır (tur çalıştırılmayacaksa çağıran `release` etmeli). */
  claim: TurnClaim;
}

export const TURN_IN_PROGRESS_TEXT = CHAT_COPY.turnInProgress;

/** Doğrulama ve hazırlık (akış başlamadan; hatalar 4xx olarak döner). */
export async function prepareTurn(deps: Pick<TurnDeps, 'store'>, req: TurnRequest): Promise<PreparedTurn> {
  const { store } = deps;
  const text = req.text.trim();
  if (text.length > MAX_TEXT_CHARS) throw new ChatError('text_too_long', 400, 'Mesaj çok uzun. Daha kısa yazmayı dene.');
  if (req.uploadIds.length > MAX_UPLOADS) throw new ChatError('too_many_uploads', 400, `Bir mesaja en çok ${MAX_UPLOADS} ek konabilir.`);
  if (text === '' && req.uploadIds.length === 0 && !req.seedId) throw new ChatError('empty', 400, 'Bir şey yaz ya da fotoğraf ekle.');

  const seed = req.seedId ? await store.getSeed(req.student, req.seedId) : null;
  if (req.seedId && !seed) throw new ChatError('seed_not_found', 404, 'Bu teşhis bulunamadı.');

  const ids = [...new Set([...req.uploadIds, ...(seed?.uploadIds ?? [])])].slice(0, MAX_UPLOADS);
  const uploads = ids.length > 0 ? await store.getUploads(req.student, ids) : [];
  const missing = req.uploadIds.filter((id) => !uploads.some((u) => u.id === id));
  if (missing.length > 0) throw new ChatError('upload_not_found', 404, 'Eklediğin dosya bulunamadı. Yeniden eklemeyi dene.');
  // Sıra: öğrencinin eklediği sırayla, teşhis ekleri sonra.
  uploads.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  if (uploads.reduce((n, u) => n + mediaCost(u), 0) > TURN_MEDIA_B64) {
    throw new ChatError('uploads_too_large', 413, 'Ekler toplamda çok büyük. Daha az ya da daha küçük dosya ekle.');
  }

  let conversation: ConversationRow | null = null;
  if (req.conversationId) {
    conversation = await store.getConversation(req.student, req.conversationId);
    if (!conversation) throw new ChatError('conversation_not_found', 404, 'Bu sohbet bulunamadı.');
  } else {
    conversation = await store.createConversation(req.student, req.mode ?? 'hint');
  }
  // Aynı sohbette iki tur iç içe yazılırsa saklanan sıra (system/araç çiftleri) API'nin reddettiği biçime bozulur.
  const claim = await store.claimTurn(conversation.id);
  if (!claim) throw new ChatError('turn_in_progress', 409, TURN_IN_PROGRESS_TEXT);
  try {
    if (req.mode && req.mode !== conversation.mode) {
      await store.setMode(req.student, conversation.id, req.mode);
      conversation = { ...conversation, mode: req.mode };
    }
  } catch (err) {
    await claim.release();
    throw err;
  }
  return { req: { ...req, text }, conversation, uploads, seed, claim };
}

function loaderFor(store: ChatStore, student: ChatStudent, known: readonly UploadRow[]): UploadLoader {
  const rows = new Map(known.map((u) => [u.id, u] as const));
  const memo = new Map<string, Promise<BetaContentBlockParam | null>>();
  return (id) => {
    let p = memo.get(id);
    if (!p) {
      p = (async () => {
        let row = rows.get(id);
        if (!row) row = (await store.getUploads(student, [id]))[0];
        if (!row) return null;
        const blob = row.anthropicFileId ? null : await store.readUpload(student, row);
        return uploadBlock(row, blob?.data ?? null);
      })();
      memo.set(id, p);
    }
    return p;
  };
}

/** Kullanıcıya gösterilen genel hata iletisi (ayrıntı günlüğe). */
const LLM_ERROR_TEXT = 'Koç şu an yanıt veremedi. Biraz sonra yeniden dene.';

/** Turu yürütür; olayları `emit` ile yayımlar. Hiç fırlatmaz: hata `error` olayıdır. Bitişte tur kilidini bırakır. */
export async function executeTurn(deps: TurnDeps, prepared: PreparedTurn, emit: (ev: ChatEvent) => void): Promise<void> {
  try {
    await runTurn(deps, prepared, emit);
  } finally {
    await prepared.claim.release().catch((err: unknown) => console.error('OGR-CHAT-010 tur kilidi bırakılamadı', err));
  }
}

async function runTurn(deps: TurnDeps, prepared: PreparedTurn, emit: (ev: ChatEvent) => void): Promise<void> {
  const { store, gateway } = deps;
  const { req, conversation, uploads, seed } = prepared;
  const student = req.student;
  const route = coachRouteFor(conversation.mode);

  // Geçmiş, yeni kullanıcı turundan önce okunur: kademeli pencerenin başından itibaren (bkz. history.ts).
  const content = userContent(req.text, uploads, seed);
  let stored: Awaited<ReturnType<ChatStore['listMessages']>>;
  let total: number;
  try {
    const afterId = conversation.summaryUptoMessageId;
    total = await store.countMessages(conversation.id, afterId);
    stored = total > 0 ? await store.listMessages(conversation.id, { afterId, limit: total - steppedStart(total) }) : [];
    const [userMessageId] = await store.appendMessages(conversation.id, [
      { role: 'user', content, uploadIds: uploads.map((u) => u.id) },
    ]);
    emit({ type: 'start', conversationId: conversation.id, userMessageId: userMessageId ?? 0, mode: conversation.mode });
  } catch (err) {
    console.error('OGR-CHAT-009 kullanıcı turu kaydedilemedi', err);
    emit({ type: 'error', code: 'store_error', message: 'Mesajın kaydedilemedi. Biraz sonra yeniden dene.' });
    return;
  }

  try {
    // Ek bütçesi için geçmişteki eklerin boyları (satır meta verisinden; dosyalar yalnız pencerede kalırsa indirilir).
    const historyIds = [...new Set(stored.flatMap(uploadIdsOf))].filter((id) => !uploads.some((u) => u.id === id));
    const known = [...uploads, ...(historyIds.length > 0 ? await store.getUploads(student, historyIds) : [])];
    const uploadRows = new Map(known.map((u) => [u.id, u] as const));
    const cost = (ids: readonly string[]) => ids.reduce((n, id) => n + mediaCost(uploadRows.get(id)), 0);
    const load = loaderFor(store, student, known);
    const history = await buildHistory(stored, conversation.summary, load, {
      total,
      mediaSize: (m) => cost(uploadIdsOf(m)),
      reserve: cost(uploads.map((u) => u.id)),
    });
    const userBlocks = await hydrateBlocks(content, load);
    const product = await deps.product(route);
    const blocks = await store.systemBlocks(student, conversation.id);

    let turnMeta: TurnMeta | null = null;
    const runners: ToolRunners = {
      ...store.toolRunners(student),
      record_turn_meta: (input) => {
        turnMeta = { ...input, mode_suggestion: input.mode_suggestion ?? null };
        return 'Tur kaydedildi.';
      },
    };

    const onEvent = (ev: StreamEvent) => {
      if (ev.type === 'text') emit({ type: 'text', text: ev.text });
      else if (ev.type === 'tool_use') emit({ type: 'tool', name: ev.name });
      else if (ev.type === 'restart') emit({ type: 'restart' });
    };

    const result: CallResult<null> = await gateway.call(route, {
      system: { product: product.text, course: blocks.course, dossier: blocks.dossier },
      history,
      user: userBlocks,
      turn: { now: deps.now?.() ?? new Date(), mode: conversation.mode },
      promptVersion: product.version,
      studentRef: student.publicRef,
      ref: { table: 'conversations', id: conversation.id },
      tools: { runners, memory: { store: store.memoryStore(conversation.id), studentId: student.studentId, actor: 'coach' } },
      onEvent,
      ...(req.signal ? { signal: req.signal } : {}),
    });

    const meta = turnMeta as TurnMeta | null;
    let escalated = false;
    if (result.refusal?.notify_instructor) {
      escalated = await store.escalate({ student, conversationId: conversation.id, reason: 'refusal', category: result.refusal.category, note: null });
    } else if (meta?.escalate_to_instructor) {
      escalated = await store.escalate({ student, conversationId: conversation.id, reason: 'turn_meta', category: null, note: meta.note ?? null });
    }

    // Transkriptin yeni kısmı: [geçmiş…, kullanıcı turu, (tur sistem mesajı), araç turları…, son yanıt].
    const delta = result.transcript.slice(history.length + 1).map(toStored);
    const record: TurnRecord = {
      calls: result.toolCalls.map((c) => ({ name: c.name, isError: c.isError })),
      turnMeta: meta,
      refusal: result.refusal ? { category: result.refusal.category } : null,
      escalated,
      route,
      model: result.model ?? null,
    };
    const lastLedger = result.ledgerIds.length > 0 ? (result.ledgerIds[result.ledgerIds.length - 1] ?? null) : null;
    const rows = delta.map((m, i) =>
      i === delta.length - 1 ? { ...m, llmCallId: lastLedger, toolCalls: record } : { ...m, content: m.content as StoredBlock[] },
    );
    const ids = rows.length > 0 ? await store.appendMessages(conversation.id, rows) : [];
    emit({
      type: 'done',
      messageId: ids.length > 0 ? (ids[ids.length - 1] ?? null) : null,
      text: result.text,
      refusal: result.refusal !== null,
      escalated,
      modeSuggestion: meta?.mode_suggestion && meta.mode_suggestion !== conversation.mode ? meta.mode_suggestion : null,
    });
  } catch (err) {
    console.error('OGR-CHAT-001 koç turu başarısız', err);
    emit({ type: 'error', code: 'llm_error', message: LLM_ERROR_TEXT });
  }
}
