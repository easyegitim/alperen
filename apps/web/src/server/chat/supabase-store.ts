/**
 * Üretim deposu: kullanıcının JWT'li Supabase istemcisi (`@supabase/ssr` sunucu istemcisi; service_role YOK, doğrudan
 * Postgres bağlantısı YOK). Her okuma ve yazım supabase/migrations/0028_coach_rpcs.sql koç RPC'lerinden geçer; kapsam
 * DB'de kurulur (app.coach_conversation: kind=coach, öğrencinin kendisi, katılımcı = auth.uid(); başka öğrenci ve veli
 * 42501). Storage nesneleri ve `uploads` satırı yine kullanıcının JWT'siyle (RLS + Storage politikaları).
 *
 * Güvenilir yazımlar (assistant/system/araç turları, `llm_calls`, hafıza aracı, eğitmen yönlendirmesi) sunucu jetonu
 * ister (server-token.ts): anahtar yalnız bu sürecin ortamındadır; aynı RPC'yi tarayıcıdan JWT ile çağıran öğrenci
 * model çıktısı taklit edemez (OGR-COACH-001).
 *
 * Tur kilidi: `secure.coach_turns` kirası (coach_claim_turn / coach_release_turn); süreç ölürse kira TURN_LEASE_S sonra
 * düşer. PostgREST işlem kipinde çalıştığından oturum düzeyinde danışma kilidi kullanılamaz.
 *
 * Bağlam: system[2] dossier `coach_context` → önbellek metni ya da `render_dossier` gövdesi → `renderDossierText`;
 * system[1] ders bloğu verisi → `renderCourseText` (süreç içi önbellek, ders + müfredat anahtarı); hafıza dosyaları aynı
 * çağrıda gelir ve hafıza aracının deposunu (CoachMemoryStore) besler.
 */
import 'server-only';
import { randomUUID, createHash } from 'node:crypto';
import {
  CourseBlockCache,
  MEMORY_CONFLICT_CODE,
  MemoryError,
  renderCourseText,
  renderDossierText,
  sha256Hex,
  toMemoryError,
  type CourseBlockData,
  type LedgerRow,
  type LedgerWriter,
  type MemoryFileMeta,
  type MemoryOp,
  type MemoryStore,
  type MemoryWriteOptions,
  toLedgerRecord,
  type ToolRunners,
} from '@ogrenmen/llm';
import { bandOf, escalationBody, evidenceWords, snippet } from './format';
import { mintServerToken } from './server-token';
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
import { isCoachMode } from './types';

/** PostgREST yanıtı (supabase-js). */
export interface RpcResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

/** Kullanıcının JWT'li Supabase istemcisinden gereken dar parça: RPC, Storage, uploads ekleme. */
export interface CoachDbClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
  storage: {
    from(bucket: string): {
      upload(path: string, body: Uint8Array | Blob, opts: { contentType: string; upsert: boolean }): PromiseLike<{ error: { message: string } | null }>;
      download(path: string): PromiseLike<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
  from(table: 'uploads'): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
  };
}

export const UPLOADS_BUCKET = 'uploads';
/** Tur kirası (sn): rota en çok 120 sn sürer; süreç ölürse kilit bu kadar sonra açılır. */
export const TURN_LEASE_S = 180;
const DOSSIER_MAX_AGE_S = 5 * 60;
const courseCache = new CourseBlockCache();

/** RPC hatası (SQLSTATE ve OGR-* iletisiyle). */
export class CoachRpcError extends Error {
  constructor(
    readonly fn: string,
    readonly code: string | null,
    message: string,
  ) {
    super(`${fn}: ${message}`);
    this.name = 'CoachRpcError';
  }
  get forbidden(): boolean {
    return this.code === '42501';
  }
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const day = (v: unknown): string | null => (v ? new Date(String(v)).toISOString().slice(0, 10) : null);

function conv(c: Obj): ConversationRow {
  return {
    id: String(c.id),
    mode: isCoachMode(c.mode) ? c.mode : 'hint',
    courseId: str(c.course_id),
    summary: typeof c.summary === 'string' ? c.summary : null,
    summaryUptoMessageId: num(c.summary_upto_message_id),
  };
}

function upload(r: Obj): UploadRow {
  return {
    id: String(r.id),
    kind: r.kind === 'pdf' ? 'pdf' : 'photo',
    mime: String(r.mime ?? (r.kind === 'pdf' ? 'application/pdf' : 'image/jpeg')),
    storagePath: String(r.storage_path),
    anthropicFileId: str(r.anthropic_file_id),
    bytes: num(r.bytes),
  };
}

function message(m: Obj): StoredMessage {
  return {
    id: Number(m.id),
    role: m.role as StoredMessage['role'],
    content: (Array.isArray(m.content) ? m.content : []) as StoredBlock[],
    uploadIds: strs(m.upload_ids),
    toolCalls: (m.tool_calls ?? null) as TurnRecord | null,
    createdAt: new Date(String(m.created_at)).toISOString(),
  };
}

interface History {
  conversation: (ConversationRow & { turnInProgress: boolean }) | null;
  total: number;
  messages: StoredMessage[];
}

export class SupabaseChatStore implements ChatStore {
  readonly kind = 'supabase' as const;
  /** Sohbet başına hafıza deposu (bağlam çağrısı doldurur; aynı istek içinde paylaşılır). */
  private readonly memories = new Map<string, CoachMemoryStore>();

  constructor(
    private readonly db: CoachDbClient,
    /** Sunucu anahtarı (OGRENMEN_WEB_COACH_KEY); tarayıcıya gitmez. */
    private readonly key: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Sohbete bağlı, kısa ömürlü sunucu jetonu. */
  token(conversationId: string): string {
    return mintServerToken(this.key, conversationId, this.now());
  }

  async call(fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) throw new CoachRpcError(fn, error.code ?? null, error.message);
    return data;
  }

  /** Yetki hatasını (42501: başka öğrencinin sohbeti, veli) null'a çevirir; diğer hatalar fırlar. */
  private async maybe<T>(p: Promise<T>): Promise<T | null> {
    try {
      return await p;
    } catch (err) {
      if (err instanceof CoachRpcError && err.forbidden) return null;
      throw err;
    }
  }

  private async history(conversationId: string | null, limit: number, afterId: number | null = null): Promise<History | null> {
    const raw = await this.maybe(this.call('coach_history', { p_conversation: conversationId, p_limit: limit, p_after_id: afterId }));
    if (raw === null) return null;
    const h = obj(raw);
    const c = h.conversation ? obj(h.conversation) : null;
    return {
      conversation: c ? { ...conv(c), turnInProgress: c.turn_in_progress === true } : null,
      total: Number(h.total ?? 0),
      messages: Array.isArray(h.messages) ? h.messages.map((m) => message(obj(m))) : [],
    };
  }

  async resolveStudent(profileId: string): Promise<ChatStudent | null> {
    const raw = await this.maybe(this.call('coach_student'));
    if (!raw) return null;
    const r = obj(raw);
    if (!r.student_id) return null;
    return {
      profileId,
      studentId: String(r.student_id),
      publicRef: String(r.public_ref),
      enrollmentId: str(r.enrollment_id),
      courseId: str(r.course_id),
    };
  }

  async latestConversation(_s: ChatStudent): Promise<ConversationRow | null> {
    return (await this.history(null, 0))?.conversation ?? null;
  }

  async getConversation(_s: ChatStudent, id: string): Promise<ConversationRow | null> {
    const c = (await this.history(id, 0))?.conversation ?? null;
    return c ? { id: c.id, mode: c.mode, courseId: c.courseId, summary: c.summary, summaryUptoMessageId: c.summaryUptoMessageId } : null;
  }

  async createConversation(s: ChatStudent, mode: CoachMode): Promise<ConversationRow> {
    const id = String(await this.call('coach_open_conversation', { p_course: null, p_mode: mode }));
    return { id, mode, courseId: s.courseId, summary: null, summaryUptoMessageId: null };
  }

  async setMode(_s: ChatStudent, conversationId: string, mode: CoachMode): Promise<boolean> {
    return (await this.maybe(this.call('coach_set_mode', { p_conversation: conversationId, p_mode: mode }))) === true;
  }

  async claimTurn(conversationId: string): Promise<TurnClaim | null> {
    const token = await this.call('coach_claim_turn', { p_conversation: conversationId, p_ttl_s: TURN_LEASE_S });
    if (!token) return null;
    let done = false;
    return {
      release: async () => {
        if (done) return;
        done = true;
        await this.call('coach_release_turn', { p_conversation: conversationId, p_token: token });
      },
    };
  }

  async turnInProgress(conversationId: string): Promise<boolean> {
    return (await this.history(conversationId, 0))?.conversation?.turnInProgress ?? false;
  }

  async countMessages(conversationId: string, afterId: number | null): Promise<number> {
    return (await this.history(conversationId, 0, afterId))?.total ?? 0;
  }

  async listMessages(conversationId: string, opts: { afterId?: number | null; limit: number }): Promise<StoredMessage[]> {
    return (await this.history(conversationId, opts.limit, opts.afterId ?? null))?.messages ?? [];
  }

  async appendMessages(
    conversationId: string,
    messages: { role: StoredMessage['role']; content: StoredBlock[]; uploadIds?: string[]; llmCallId?: number | null; toolCalls?: TurnRecord | null }[],
  ): Promise<number[]> {
    if (messages.length === 0) return [];
    const token = this.token(conversationId);
    if (messages.length === 1) {
      const m = messages[0]!;
      const id = await this.call('coach_append_message', {
        p_conversation: conversationId,
        p_role: m.role,
        p_content: m.content,
        p_upload_ids: m.uploadIds ?? [],
        p_llm_call_id: m.llmCallId ?? null,
        p_tool_calls: m.toolCalls ?? null,
        p_server_token: token,
      });
      return [Number(id)];
    }
    // Turun model tarafı (system, araç turları, son yanıt) tek işlemde: yarım transkript saklanmaz.
    const ids = await this.call('coach_append_turn', {
      p_conversation: conversationId,
      p_messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        upload_ids: m.uploadIds ?? [],
        llm_call_id: m.llmCallId ?? null,
        tool_calls: m.toolCalls ?? null,
      })),
      p_server_token: token,
    });
    return (Array.isArray(ids) ? ids : []).map(Number);
  }

  async getUploads(_s: ChatStudent, ids: readonly string[]): Promise<UploadRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.call('coach_uploads', { p_ids: [...ids] });
    return (Array.isArray(rows) ? rows : []).map((r) => upload(obj(r)));
  }

  async readUpload(_s: ChatStudent, u: UploadRow): Promise<UploadBlob | null> {
    const { data, error } = await this.db.storage.from(UPLOADS_BUCKET).download(u.storagePath);
    if (error || !data) return null;
    return { mime: u.mime, data: new Uint8Array(await data.arrayBuffer()) };
  }

  async saveUpload(
    s: ChatStudent,
    file: { mime: string; data: Uint8Array; kind: UploadRow['kind']; width?: number | null; height?: number | null },
  ): Promise<UploadRow> {
    const id = randomUUID();
    const ext = file.kind === 'pdf' ? 'pdf' : file.mime === 'image/png' ? 'png' : file.mime === 'image/webp' ? 'webp' : 'jpg';
    const path = `${s.profileId}/${id}.${ext}`;
    const up = await this.db.storage.from(UPLOADS_BUCKET).upload(path, file.data, { contentType: file.mime, upsert: false });
    if (up.error) throw new Error(`OGR-CHAT-004 Storage yüklemesi başarısız: ${up.error.message}`);
    const ins = await this.db.from('uploads').insert({
      id,
      owner_id: s.profileId,
      student_id: s.studentId,
      kind: file.kind,
      storage_path: path,
      mime: file.mime,
      bytes: file.data.byteLength,
      sha256: createHash('sha256').update(file.data).digest('hex'),
      width: file.width ?? null,
      height: file.height ?? null,
    });
    if (ins.error) throw new Error(`OGR-CHAT-005 yükleme satırı yazılamadı: ${ins.error.message}`);
    return { id, kind: file.kind, mime: file.mime, storagePath: path, anthropicFileId: null, bytes: file.data.byteLength };
  }

  async getSeed(_s: ChatStudent, id: string): Promise<SeedContext | null> {
    const raw = await this.call('coach_seed', { p_analysis: id });
    if (!raw) return null;
    const r = obj(raw);
    return {
      id: String(r.id),
      questionText: str(r.question_text),
      studentWorkText: str(r.student_work_text),
      verdict: str(r.verdict),
      failingStepNo: num(r.failing_step_no),
      errorCause: str(r.error_cause),
      skillIds: strs(r.skill_ids),
      misconceptionTags: strs(r.misconception_tags),
      summary: str(r.why),
      uploadIds: strs(r.upload_ids),
    };
  }

  /** Eğitmen yönlendirmesi (notifications, sohbet başına 24 saatte bir; DB'de). Hata turu düşürmez. */
  async escalate(input: EscalationInput): Promise<boolean> {
    try {
      const ok = await this.call('coach_escalate', {
        p_conversation: input.conversationId,
        p_reason: input.reason,
        p_category: input.category,
        p_body: escalationBody(input),
        p_server_token: this.token(input.conversationId),
      });
      return ok === true;
    } catch (err) {
      console.error('OGR-CHAT-006 eğitmen yönlendirmesi yazılamadı', err);
      return false;
    }
  }

  async systemBlocks(_s: ChatStudent, conversationId: string): Promise<{ course: string | null; dossier: string | null }> {
    const ctx = obj(await this.call('coach_context', { p_conversation: conversationId, p_dossier_max_age_s: DOSSIER_MAX_AGE_S }));
    if (Array.isArray(ctx.memory)) this.memoryStore(conversationId).prime(ctx.memory.map(obj));
    const d = ctx.dossier ? obj(ctx.dossier) : null;
    let dossier: string | null = null;
    if (d?.cached) dossier = str(obj(d.cached).rendered);
    else if (d?.body) dossier = renderDossierText(d.body);
    let course: string | null = null;
    if (ctx.course) {
      try {
        const data = ctx.course as CourseBlockData;
        const key = `${data.course.id}:${data.curriculum?.id ?? ''}`;
        // Aynı ders + müfredat için metin süreç içinde sabit kalır (system[1] önbellek öneki); TTL dolunca yenilenir.
        const hit = courseCache.get(key);
        if (hit) course = hit.text;
        else {
          const text = renderCourseText(data);
          courseCache.set(key, { courseId: data.course.id, curriculumId: data.curriculum?.id ?? null, text, hash: sha256Hex(text), fromCache: false });
          course = text;
        }
      } catch (err) {
        console.error('OGR-CHAT-007 ders bloğu kurulamadı', err);
      }
    }
    return { course, dossier };
  }

  toolRunners(_s: ChatStudent): ToolRunners {
    return {
      get_mastery: async (input) => {
        const codes = input.skill_codes ?? [];
        const r = obj(await this.call('coach_tool_get_mastery', { p_skill_codes: codes.length > 0 ? codes : null, p_course: input.course_id ?? null }));
        if (r.enrollment !== true) return JSON.stringify({ note: 'Bu ders için kayıt yok.', skills: [] });
        const skills = (Array.isArray(r.skills) ? r.skills : []).map((x) => {
          const k = obj(x);
          return {
            code: String(k.code),
            name: String(k.name),
            // Ham olasılık (p) modele verilmez: yüzde yerine kelime bandı (PLAN-v2 §6).
            band: bandOf(Number(k.p), Number(k.evidence_count)),
            evidence: evidenceWords(Number(k.evidence_count)),
            last_seen: day(k.last_evidence_at),
          };
        });
        return JSON.stringify({ skills, unknown_codes: codes.filter((c) => !skills.some((k) => k.code === c)) });
      },
      get_recent_exams: async (input) => {
        const r = obj(await this.call('coach_tool_get_recent_exams', { p_limit: input.limit ?? 3 }));
        const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        return JSON.stringify({
          exams: (Array.isArray(r.exams) ? r.exams : []).map((raw) => {
            const x = obj(raw);
            const score = obj(x.score);
            const sections = Array.isArray(score.sections) ? score.sections.map(obj) : [];
            return {
              title: String(x.title),
              kind: String(x.kind),
              date: day(x.finished_at),
              net: n(score.net),
              correct: n(score.correct),
              wrong: n(score.wrong),
              blank: n(score.blank),
              sections: sections.map((sec) => ({
                section: String(sec.section ?? 'Genel'),
                net: n(sec.net),
                correct: n(sec.correct),
                wrong: n(sec.wrong),
                blank: n(sec.blank),
              })),
              top_errors: {
                skills: (Array.isArray(x.weak_skills) ? x.weak_skills : []).map((w) => ({ code: String(obj(w).code), name: String(obj(w).name), missed: Number(obj(w).n) })),
                misconceptions: (Array.isArray(x.misconceptions) ? x.misconceptions : []).map((t) => ({ tag: String(obj(t).tag), count: Number(obj(t).n) })),
              },
            };
          }),
        });
      },
      search_evidence: async (input) => {
        const words = [...new Set(input.query.toLocaleLowerCase('tr').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3))].slice(0, 6);
        if (words.length === 0) return JSON.stringify({ results: [], note: 'Arama için en az bir anlamlı kelime gerekli.' });
        // Gömme (Voyage) henüz yok: kelime eşleşmesi (DB'de ILIKE); puan = eşleşen kelime sayısı, sonra yenilik.
        const r = obj(
          await this.call('coach_tool_search_evidence', { p_q: words.join(' '), p_kinds: input.kinds && input.kinds.length > 0 ? input.kinds : null, p_limit: input.limit ?? 5 }),
        );
        return JSON.stringify({
          method: 'keyword',
          results: (Array.isArray(r.results) ? r.results : []).map((raw) => {
            const x = obj(raw);
            return { kind: String(x.kind), id: String(x.id), date: day(x.at), snippet: snippet(String(x.txt ?? ''), words) };
          }),
        });
      },
    };
  }

  memoryStore(conversationId: string): CoachMemoryStore {
    let m = this.memories.get(conversationId);
    if (!m) {
      m = new CoachMemoryStore(this, conversationId);
      this.memories.set(conversationId, m);
    }
    return m;
  }

  ledger(): LedgerWriter {
    return new CoachLedger(this);
  }
}

/**
 * Hafıza aracı deposu (memory_20250818): okuma `coach_context` dosya içeriklerinden (turun başında gelir; çakışmada
 * yeniden okunur), yazım `coach_memory_write` (sunucu jetonu; actor DB'de 'coach:<sohbet>'; sınırlar, öğrenci kilidi ve
 * koşullu yazım app.memory_apply'da). Yalnız bu sohbetin öğrencisi: `studentId` argümanı DB'de sohbetten türetilir.
 */
export class CoachMemoryStore implements MemoryStore {
  private files: Map<string, { content: string; bytes: number; updatedAt: string }> | null = null;

  constructor(
    private readonly store: SupabaseChatStore,
    private readonly conversationId: string,
  ) {}

  prime(rows: Record<string, unknown>[]): void {
    this.files = new Map(
      rows.map((r) => [String(r.path), { content: String(r.content ?? ''), bytes: Number(r.bytes ?? 0), updatedAt: new Date(String(r.updated_at)).toISOString() }]),
    );
  }

  private async load(): Promise<NonNullable<CoachMemoryStore['files']>> {
    if (!this.files) {
      const ctx = obj(await this.store.call('coach_context', { p_conversation: this.conversationId, p_parts: ['memory'] }));
      this.prime(Array.isArray(ctx.memory) ? ctx.memory.map(obj) : []);
    }
    return this.files!;
  }

  async list(_studentId: string): Promise<MemoryFileMeta[]> {
    return [...(await this.load()).entries()].map(([path, f]) => ({ path, bytes: f.bytes, updatedAt: f.updatedAt })).sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  async read(_studentId: string, path: string): Promise<string | null> {
    return (await this.load()).get(path)?.content ?? null;
  }

  private async apply(path: string, content: string | null, op: MemoryOp, newPath: string | null, expectedHash: string | null): Promise<void> {
    try {
      await this.store.call('coach_memory_write', {
        p_conversation: this.conversationId,
        p_path: path,
        p_content: content,
        p_op: op,
        p_new_path: newPath,
        p_expected_hash: expectedHash,
        p_server_token: this.store.token(this.conversationId),
      });
    } catch (err) {
      const e = toMemoryError(err);
      // Araya başka yazıcı girdiyse (OGR-MEM-028) işleyici yeniden okur: güncel içerik DB'den gelsin.
      if (e instanceof MemoryError && e.code === MEMORY_CONFLICT_CODE) this.files = null;
      throw e;
    }
    const files = await this.load();
    const stamp = new Date().toISOString();
    if (op === 'delete') files.delete(path);
    else if (op === 'rename' && newPath) {
      const f = files.get(path);
      files.delete(path);
      if (f) files.set(newPath, { ...f, updatedAt: stamp });
    } else if (content !== null) files.set(path, { content, bytes: Buffer.byteLength(content, 'utf8'), updatedAt: stamp });
  }

  write(_studentId: string, path: string, content: string, op: MemoryOp, _actor: string, opts: MemoryWriteOptions = {}): Promise<void> {
    return this.apply(path, content, op, null, opts.expectedHash ?? null);
  }

  remove(_studentId: string, path: string, _actor: string): Promise<void> {
    return this.apply(path, null, 'delete', null, null);
  }

  rename(_studentId: string, oldPath: string, newPath: string, _actor: string): Promise<void> {
    return this.apply(oldPath, null, 'rename', newPath, null);
  }
}

/**
 * Defter yazıcısı: `coach_log_llm_call` (sunucu jetonu). Sohbet satırın `ref_id`'sinden gelir (geçit koç turunda
 * `ref: {table: 'conversations', id}` verir); student_ref DB'de sohbetin öğrencisinden türetilir. Yazma hatası çağrıyı
 * düşürmez.
 */
export class CoachLedger implements LedgerWriter {
  constructor(private readonly store: SupabaseChatStore) {}

  async write(row: LedgerRow): Promise<number | null> {
    try {
      if (row.ref_table !== 'conversations' || !row.ref_id) throw new Error('koç defter satırı sohbete bağlı olmalı (ref conversations)');
      const id = await this.store.call('coach_log_llm_call', {
        p_conversation: row.ref_id,
        p_call: toLedgerRecord(row),
        p_server_token: this.store.token(row.ref_id),
      });
      return id === null || id === undefined ? null : Number(id);
    } catch (err) {
      console.error('OGR-LLM-009 llm_calls yazılamadı', err);
      return null;
    }
  }
}
