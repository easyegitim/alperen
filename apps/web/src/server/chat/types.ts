/**
 * Koç sohbeti (PLAN-v2 §2 Akış 1, §3.3, §6): sunucu tarafı tipleri. Depo (`ChatStore`) iki biçimde gelir:
 *   - `SupabaseChatStore` (üretim): yalnız kullanıcının JWT'li Supabase istemcisi; okuma ve yazımlar 0028 koç RPC'leri,
 *     güvenilir yazımlar sunucu jetonuyla (server-token.ts). service_role ve doğrudan Postgres bağlantısı yok.
 *   - `MemoryChatStore` (yalnız OGRENMEN_LLM=fake ile; E2E ve yerel geliştirme): süreç içi, deterministik.
 */
import type { CoachMode, ToolRunners } from '@ogrenmen/llm';
import type { MemoryStore } from '@ogrenmen/llm';

export type { CoachMode };

export const COACH_MODES: readonly CoachMode[] = ['hint', 'explain', 'solve'];

export function isCoachMode(v: unknown): v is CoachMode {
  return typeof v === 'string' && (COACH_MODES as readonly string[]).includes(v);
}

/** Oturumdaki öğrenci (rota işleyicisi doğrular, depo çözer). */
export interface ChatStudent {
  /** profiles.id (auth.uid()). */
  profileId: string;
  /** students.id. */
  studentId: string;
  /** students.public_ref (LLM defteri). */
  publicRef: string;
  /** Etkin kaydın dersi (yoksa null: ders/dossier blokları gönderilmez). */
  courseId: string | null;
  enrollmentId: string | null;
}

export interface ConversationRow {
  id: string;
  mode: CoachMode;
  courseId: string | null;
  summary: string | null;
  summaryUptoMessageId: number | null;
}

/** Saklanan içerik bloğu: Anthropic blokları; görsel/belge base64 yerine yükleme başvurusuyla saklanır. */
export type StoredBlock = Record<string, unknown> & { type: string };

export interface StoredMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: StoredBlock[];
  uploadIds: string[];
  toolCalls: TurnRecord | null;
  createdAt: string;
}

/** `conversation_messages.tool_calls` (asistanın son mesajında): araç özeti, tur kaydı, ret ve yönlendirme. */
export interface TurnRecord {
  calls: { name: string; isError: boolean }[];
  turnMeta: TurnMeta | null;
  refusal: { category: string | null } | null;
  escalated: boolean;
  route: string;
  model: string | null;
}

export interface TurnMeta {
  skill_ids: string[];
  misconception_tags: string[];
  mode_suggestion: CoachMode | null;
  escalate_to_instructor: boolean;
  confidence: number;
  note?: string | undefined;
}

export interface UploadRow {
  id: string;
  kind: 'photo' | 'pdf';
  mime: string;
  storagePath: string;
  anthropicFileId: string | null;
  bytes: number | null;
}

export interface UploadBlob {
  mime: string;
  data: Uint8Array;
}

/** Teşhis bağlamı ("Koça sor" derin bağlantısı, /ogrenci/koc?seed=<solution_analysis_id>). */
export interface SeedContext {
  id: string;
  questionText: string | null;
  studentWorkText: string | null;
  verdict: string | null;
  failingStepNo: number | null;
  errorCause: string | null;
  skillIds: string[];
  misconceptionTags: string[];
  /** Analizin kısa özeti (analysis.summary_tr ya da benzeri). */
  summary: string | null;
  uploadIds: string[];
}

export interface EscalationInput {
  student: ChatStudent;
  conversationId: string;
  reason: 'refusal' | 'turn_meta';
  category: string | null;
  note: string | null;
}

/** Sohbetin tur kilidi (aynı sohbette aynı anda tek tur). `release` birden çok çağrılabilir. */
export interface TurnClaim {
  release(): Promise<void>;
}

export interface ChatStore {
  readonly kind: 'supabase' | 'memory';
  /** Oturum kullanıcısının öğrenci kaydı; öğrenci değilse null. */
  resolveStudent(profileId: string): Promise<ChatStudent | null>;
  /** Öğrencinin en son koç sohbeti. */
  latestConversation(student: ChatStudent): Promise<ConversationRow | null>;
  /** Kimlik öğrenciye (ve katılımcıya) ait değilse null. */
  getConversation(student: ChatStudent, id: string): Promise<ConversationRow | null>;
  createConversation(student: ChatStudent, mode: CoachMode): Promise<ConversationRow>;
  /** Modu öğrenci değiştirir (model değiştiremez). */
  setMode(student: ChatStudent, conversationId: string, mode: CoachMode): Promise<boolean>;
  /**
   * Tur kilidini alır; sohbette başka bir tur sürüyorsa null. Kilit tur bitene (ya da süreç/bağlantı ölene) dek
   * tutulur. Aynı sohbette iki tur iç içe yazılırsa saklanan sıra API'nin reddettiği biçime bozulur.
   */
  claimTurn(conversationId: string): Promise<TurnClaim | null>;
  /** Sohbette şu an bir tur sürüyor mu (koç sayfası "yazıyor" gösterir, gönderim kapalı kalır). */
  turnInProgress(conversationId: string): Promise<boolean>;
  /** Özetten sonraki mesaj sayısı (kademeli pencere çapası). */
  countMessages(conversationId: string, afterId: number | null): Promise<number>;
  /** Özetten sonraki mesajlar, eskiden yeniye; `limit` en yeni N. */
  listMessages(conversationId: string, opts: { afterId?: number | null; limit: number }): Promise<StoredMessage[]>;
  appendMessages(
    conversationId: string,
    messages: { role: StoredMessage['role']; content: StoredBlock[]; uploadIds?: string[]; llmCallId?: number | null; toolCalls?: TurnRecord | null }[],
  ): Promise<number[]>;
  /** Öğrenciye (sahibi ya da öğrencisi) ait yüklemeler; bulunamayan kimlik dönmez. */
  getUploads(student: ChatStudent, ids: readonly string[]): Promise<UploadRow[]>;
  readUpload(student: ChatStudent, upload: UploadRow): Promise<UploadBlob | null>;
  saveUpload(student: ChatStudent, file: { mime: string; data: Uint8Array; kind: UploadRow['kind']; width?: number | null; height?: number | null }): Promise<UploadRow>;
  getSeed(student: ChatStudent, solutionAnalysisId: string): Promise<SeedContext | null>;
  /** Eğitmene yönlendirme notu (instructor_notes + eğitmen bildirimi); yazıldıysa true. */
  escalate(input: EscalationInput): Promise<boolean>;
  /** system[1] ders ve system[2] dossier blokları (sohbetin dersi, yoksa etkin kaydın dersi; yoksa null). */
  systemBlocks(student: ChatStudent, conversationId: string): Promise<{ course: string | null; dossier: string | null }>;
  /** Koç araçlarının çalıştırıcıları (search_evidence, get_mastery, get_recent_exams). record_turn_meta turda bağlanır. */
  toolRunners(student: ChatStudent): ToolRunners;
  /** Hafıza aracı deposu (memory_20250818); yazımlar bu sohbete bağlı (actor coach:<sohbet>). */
  memoryStore(conversationId: string): MemoryStore;
  /** Defter (llm_calls) yazıcısı (satır `ref` ile sohbete bağlıdır). */
  ledger(): import('@ogrenmen/llm').LedgerWriter;
}
