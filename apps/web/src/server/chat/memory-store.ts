/**
 * Süreç içi depo: yalnız sahte LLM ile (OGRENMEN_CHAT_STORE=memory + OGRENMEN_LLM=fake) E2E ve veritabanısız yerel
 * geliştirme içindir. Gerçek veriye dokunmaz; sunucu yeniden başlayınca sıfırlanır. Davranışı `PgChatStore` ile aynı
 * sözleşmeye uyar (kapsam, mod, yükleme, teşhis bağlamı, yönlendirme) ve testlerde gövde denetimi için kullanılır.
 */
import { createHash, randomUUID } from 'node:crypto';
import { InMemoryLedger, InMemoryStore, type LedgerWriter, type MemoryStore, type ToolRunners } from '@ogrenmen/llm';
import { ESCALATION_DEDUPE_MS } from './format';
import type {
  ChatStore,
  ChatStudent,
  CoachMode,
  ConversationRow,
  EscalationInput,
  SeedContext,
  StoredBlock,
  StoredMessage,
  TurnClaim,
  TurnRecord,
  UploadBlob,
  UploadRow,
} from './types';

/** Sahte deponun her öğrenciye açtığı örnek teşhis (E2E: /ogrenci/koc?seed=…). */
export const DEMO_SEED_ID = '7e5d0000-0000-4000-8000-0000000000a1';
export const DEMO_COURSE_ID = '50000000-0000-4000-8000-000000000001';

export const DEMO_COURSE_BLOCK = [
  'Ders: TYT Matematik (TYT-MAT). Müfredat ağacı (kod · ad):',
  '▸ tyt.mat.temel · Temel kavramlar',
  '• tyt.mat.temel.rasyonel-sayilar · Rasyonel sayılar',
  '• tyt.mat.temel.uslu-sayilar · Üslü sayılar',
  '▸ tyt.mat.denklem · Denklemler',
  '• tyt.mat.denklem.birinci-derece · Birinci dereceden denklemler',
  'Yanılgı etiketleri: isaret-dagitma (eksiyi paranteze dağıtırken işaret), payda-toplama (kesirde paydaları toplama).',
].join('\n');

export const DEMO_DOSSIER_BLOCK = [
  'Öğrenci: 11. sınıf, hedef TYT.',
  'En zayıf yapraklar: tyt.mat.denklem.birinci-derece (p 0.35, 6 kanıt), tyt.mat.temel.rasyonel-sayilar (p 0.42, 9 kanıt).',
  'Açık yanılgılar: isaret-dagitma (3 kez; 12, 19, 27 Eki).',
  'Son etkinlik: 2026-10-27 teşhis, yanlış, işlem hatası, 3. adım.',
].join('\n');

interface Conv extends ConversationRow {
  studentId: string;
  participantId: string;
  lastMessageAt: number;
}

interface State {
  conversations: Map<string, Conv>;
  messages: Map<string, (StoredMessage & { llmCallId: number | null })[]>;
  uploads: Map<string, UploadRow & { studentId: string; ownerId: string; data: Uint8Array }>;
  escalations: EscalationInput[];
  /** Sohbet → son yönlendirme zamanı (24 saatte bir). */
  escalatedAt: Map<string, number>;
  /** Turu süren sohbetler (tur kilidi). */
  running: Set<string>;
  nextId: number;
  memory: InMemoryStore;
  ledger: InMemoryLedger;
}

function freshState(): State {
  return {
    conversations: new Map(),
    messages: new Map(),
    uploads: new Map(),
    escalations: [],
    escalatedAt: new Map(),
    running: new Set(),
    nextId: 1,
    memory: new InMemoryStore(),
    ledger: new InMemoryLedger(),
  };
}

const KEY = Symbol.for('ogrenmen.chat.memory-store');
type Global = typeof globalThis & { [KEY]?: State };

/** Süreç genelindeki durum (Next.js modülleri yeniden yüklese de korunur). */
function sharedState(): State {
  const g = globalThis as Global;
  g[KEY] ??= freshState();
  return g[KEY];
}

function stableUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export class MemoryChatStore implements ChatStore {
  readonly kind = 'memory' as const;
  readonly state: State;

  constructor(opts: { isolated?: boolean } = {}) {
    this.state = opts.isolated ? freshState() : sharedState();
  }

  async resolveStudent(profileId: string): Promise<ChatStudent | null> {
    const ref = createHash('sha256').update(`ref:${profileId}`).digest('hex').replace(/[^a-z0-9]/g, '').slice(0, 12);
    return {
      profileId,
      studentId: stableUuid(`student:${profileId}`),
      publicRef: `s_${ref}`,
      courseId: DEMO_COURSE_ID,
      enrollmentId: stableUuid(`enrollment:${profileId}`),
    };
  }

  private pick(c: Conv): ConversationRow {
    return { id: c.id, mode: c.mode, courseId: c.courseId, summary: c.summary, summaryUptoMessageId: c.summaryUptoMessageId };
  }

  async latestConversation(s: ChatStudent): Promise<ConversationRow | null> {
    const mine = [...this.state.conversations.values()].filter((c) => c.studentId === s.studentId && c.participantId === s.profileId);
    mine.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    return mine[0] ? this.pick(mine[0]) : null;
  }

  async getConversation(s: ChatStudent, id: string): Promise<ConversationRow | null> {
    const c = this.state.conversations.get(id);
    return c && c.studentId === s.studentId && c.participantId === s.profileId ? this.pick(c) : null;
  }

  async createConversation(s: ChatStudent, mode: CoachMode): Promise<ConversationRow> {
    const c: Conv = {
      id: randomUUID(),
      mode,
      courseId: s.courseId,
      summary: null,
      summaryUptoMessageId: null,
      studentId: s.studentId,
      participantId: s.profileId,
      lastMessageAt: Date.now(),
    };
    this.state.conversations.set(c.id, c);
    this.state.messages.set(c.id, []);
    return this.pick(c);
  }

  async setMode(s: ChatStudent, conversationId: string, mode: CoachMode): Promise<boolean> {
    const c = this.state.conversations.get(conversationId);
    if (!c || c.studentId !== s.studentId || c.participantId !== s.profileId) return false;
    c.mode = mode;
    return true;
  }

  /** Testler: özet ayarla (worker `conversation.summarize` yerine). */
  setSummary(conversationId: string, summary: string, uptoMessageId: number): void {
    const c = this.state.conversations.get(conversationId);
    if (c) {
      c.summary = summary;
      c.summaryUptoMessageId = uptoMessageId;
    }
  }

  async claimTurn(conversationId: string): Promise<TurnClaim | null> {
    const running = this.state.running;
    if (running.has(conversationId)) return null;
    running.add(conversationId);
    return {
      release: async () => {
        running.delete(conversationId);
      },
    };
  }

  async turnInProgress(conversationId: string): Promise<boolean> {
    return this.state.running.has(conversationId);
  }

  async countMessages(conversationId: string, afterId: number | null): Promise<number> {
    return (this.state.messages.get(conversationId) ?? []).filter((m) => m.id > (afterId ?? 0)).length;
  }

  async listMessages(conversationId: string, opts: { afterId?: number | null; limit: number }): Promise<StoredMessage[]> {
    const all = (this.state.messages.get(conversationId) ?? []).filter((m) => m.id > (opts.afterId ?? 0));
    return all.slice(Math.max(0, all.length - opts.limit)).map((m) => JSON.parse(JSON.stringify(m)) as StoredMessage);
  }

  async appendMessages(
    conversationId: string,
    messages: { role: StoredMessage['role']; content: StoredBlock[]; uploadIds?: string[]; llmCallId?: number | null; toolCalls?: TurnRecord | null }[],
  ): Promise<number[]> {
    const list = this.state.messages.get(conversationId);
    if (!list) throw new Error('sohbet yok');
    const ids: number[] = [];
    for (const m of messages) {
      const id = this.state.nextId++;
      list.push({
        id,
        role: m.role,
        content: JSON.parse(JSON.stringify(m.content)) as StoredBlock[],
        uploadIds: m.uploadIds ?? [],
        toolCalls: m.toolCalls ?? null,
        createdAt: new Date().toISOString(),
        llmCallId: m.llmCallId ?? null,
      });
      ids.push(id);
    }
    const c = this.state.conversations.get(conversationId);
    if (c) c.lastMessageAt = Date.now();
    return ids;
  }

  /** Testler: ham mesajlar (llm_call_id dahil). */
  rawMessages(conversationId: string) {
    return this.state.messages.get(conversationId) ?? [];
  }

  get escalations(): readonly EscalationInput[] {
    return this.state.escalations;
  }

  async getUploads(s: ChatStudent, ids: readonly string[]): Promise<UploadRow[]> {
    return ids
      .map((id) => this.state.uploads.get(id))
      .filter((u): u is NonNullable<typeof u> => Boolean(u && u.studentId === s.studentId))
      .map(({ id, kind, mime, storagePath, anthropicFileId, bytes }) => ({ id, kind, mime, storagePath, anthropicFileId, bytes }));
  }

  async readUpload(s: ChatStudent, u: UploadRow): Promise<UploadBlob | null> {
    const row = this.state.uploads.get(u.id);
    return row && row.studentId === s.studentId ? { mime: row.mime, data: row.data } : null;
  }

  async saveUpload(s: ChatStudent, file: { mime: string; data: Uint8Array; kind: UploadRow['kind'] }): Promise<UploadRow> {
    const id = randomUUID();
    const row: UploadRow = { id, kind: file.kind, mime: file.mime, storagePath: `${s.profileId}/${id}`, anthropicFileId: null, bytes: file.data.byteLength };
    this.state.uploads.set(id, { ...row, studentId: s.studentId, ownerId: s.profileId, data: file.data });
    return row;
  }

  async getSeed(_s: ChatStudent, id: string): Promise<SeedContext | null> {
    if (id !== DEMO_SEED_ID) return null;
    return {
      id,
      questionText: '2(x+1) − 3(x−2) = 4 denkleminde x kaçtır?',
      studentWorkText: '2x+2 − 3x − 6 = 4 → −x − 4 = 4 → x = −8',
      verdict: 'wrong',
      failingStepNo: 3,
      errorCause: 'procedure',
      skillIds: ['tyt.mat.denklem.birinci-derece'],
      misconceptionTags: ['isaret-dagitma'],
      summary: 'Parantezi açarken −3 ile −2’nin çarpımını eksi yazdın.',
      uploadIds: [],
    };
  }

  async escalate(input: EscalationInput): Promise<boolean> {
    // Üretim deposuyla aynı kural: aynı sohbetten 24 saatte bir yönlendirme (önceki duruyorsa true, yeni kayıt yok).
    const now = Date.now();
    const last = this.state.escalatedAt.get(input.conversationId);
    if (last !== undefined && now - last < ESCALATION_DEDUPE_MS) return true;
    this.state.escalatedAt.set(input.conversationId, now);
    this.state.escalations.push(input);
    return true;
  }

  async systemBlocks(_s: ChatStudent, courseId: string | null): Promise<{ course: string | null; dossier: string | null }> {
    return courseId ? { course: DEMO_COURSE_BLOCK, dossier: DEMO_DOSSIER_BLOCK } : { course: null, dossier: null };
  }

  toolRunners(_s: ChatStudent): ToolRunners {
    return {
      get_mastery: () =>
        JSON.stringify({
          skills: [
            { code: 'tyt.mat.denklem.birinci-derece', name: 'Birinci dereceden denklemler', band: 'zayıf', evidence: '6 kanıt' },
            { code: 'tyt.mat.temel.rasyonel-sayilar', name: 'Rasyonel sayılar', band: 'orta', evidence: '9 kanıt' },
          ],
        }),
      get_recent_exams: () => JSON.stringify({ exams: [] }),
      search_evidence: (input) =>
        JSON.stringify({ method: 'keyword', results: input.query ? [{ kind: 'solution_analysis', id: DEMO_SEED_ID, date: '2026-10-27', snippet: 'eksi dağıtırken işaret' }] : [] }),
    };
  }

  memoryStore(): MemoryStore {
    return this.state.memory;
  }

  ledger(): LedgerWriter {
    return this.state.ledger;
  }
}
