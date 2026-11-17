/**
 * Veli sohbeti (PLAN-v2 §10, mockup S10b) sunucu tipleri. Depo iki biçimde gelir:
 *   - `SupabaseParentStore` (üretim): yalnız velinin JWT'li Supabase istemcisi; okuma ve yazımlar supabase 0043
 *     `parent_*` RPC'leri (yalnız aktif bağlı çocuk; koç sohbeti, soru/anahtar ve ham yüklemeler 42501). Model turları
 *     ve defter koç sohbetiyle aynı sunucu jetonunu ister (OGRENMEN_WEB_COACH_KEY; jeton sohbete bağlı).
 *   - `MemoryParentStore` (yalnız OGRENMEN_LLM=fake ve OGRENMEN_CHAT_STORE=memory; E2E ve yerel geliştirme).
 */
import type { LedgerWriter, ToolRunners } from '@ogrenmen/llm';
import type { StoredBlock, StoredMessage, TurnClaim } from '@/server/chat/types';

export type { StoredBlock, StoredMessage, TurnClaim };

export interface ParentConversation {
  id: string;
  studentId: string;
  summary: string | null;
  summaryUptoMessageId: number | null;
  turnInProgress: boolean;
}

export interface ParentHistory {
  conversation: ParentConversation | null;
  total: number;
  messages: StoredMessage[];
}

/** Bu turda açılan rapor isteği (sohbette durum kartı). */
export interface ReportRef {
  documentId: string;
  title: string;
  kind: string;
}

/** Asistanın son mesajındaki tur kaydı (`conversation_messages.tool_calls`). */
export interface ParentTurnRecord {
  calls: { name: string; isError: boolean }[];
  refusal: { category: string | null } | null;
  reports?: ReportRef[];
  route: 'parent_chat';
  model: string | null;
}

export interface ParentChatStore {
  readonly kind: 'supabase' | 'memory';
  /** Velinin bu çocuk için en son sohbeti; yoksa (ya da `fresh`) yenisini açar. Çocuk aktif bağlı değilse fırlatır (403). */
  openConversation(studentId: string, fresh: boolean): Promise<string>;
  /** Sohbet geçmişi (özetten sonrası); `conversationId` null → çocuğun en son sohbeti. Yetkisizse null. */
  history(opts: { conversationId: string | null; studentId: string | null; limit: number; afterId?: number | null }): Promise<ParentHistory | null>;
  claimTurn(conversationId: string): Promise<TurnClaim | null>;
  appendMessages(
    conversationId: string,
    rows: { role: StoredMessage['role']; content: StoredBlock[]; llmCallId?: number | null; toolCalls?: ParentTurnRecord | null }[],
  ): Promise<number[]>;
  /** system[2]: çocuğun kısa durum bloğu (veliye açık veri; ad ve olasılık yok). */
  childContext(studentId: string): Promise<string | null>;
  /** Veli ajanı araçlarının çalıştırıcıları (`onReport`: rapor isteği açıldı). */
  toolRunners(studentId: string, onReport: (ref: ReportRef) => void): ToolRunners;
  ledger(): LedgerWriter;
}

/** Ekran öğesi: velinin mesajı ya da asistanın son yanıtı. */
export interface ParentDisplayMessage {
  id: string;
  from: 'parent' | 'assistant';
  text: string;
  reports?: ReportRef[];
}
