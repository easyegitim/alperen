/**
 * Veli sohbeti depoları. Üretim: `SupabaseParentStore` — velinin JWT'li Supabase istemcisi ve supabase 0043 `parent_*`
 * RPC'leri (service_role ve doğrudan Postgres yok). Model turları, araç blokları ve defter (`parent_log_llm_call`)
 * koç sohbetiyle aynı sunucu jetonunu taşır (chat/server-token.ts: HMAC 'coach:<sohbet>:<bitiş>', OGRENMEN_WEB_COACH_KEY);
 * jetonsuz yalnız velinin metin mesajı yazılabilir. Tur kirası `parent_claim_turn` / `parent_release_turn`.
 *
 * `MemoryParentStore`: süreç içi, deterministik (OGRENMEN_LLM=fake + OGRENMEN_CHAT_STORE=memory; E2E ve geliştirme).
 */
import 'server-only';
import { InMemoryLedger, toLedgerRecord, type LedgerRow, type LedgerWriter, type ToolRunners } from '@ogrenmen/llm';
import { mintServerToken } from '@/server/chat/server-token';
import { parentToolRunners, ParentRpcError, type ParentRpc } from './tools';
import { childContextText } from './context';
import type { ParentChatStore, ParentConversation, ParentHistory, ParentTurnRecord, ReportRef, StoredBlock, StoredMessage, TurnClaim } from './types';

/** PostgREST yanıtı (supabase-js). */
export interface RpcResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

export interface ParentDbClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
}

/** Tur kirası (sn): rota en çok 120 sn sürer. */
export const PARENT_TURN_LEASE_S = 180;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

function message(m: Obj): StoredMessage {
  return {
    id: Number(m.id),
    role: m.role as StoredMessage['role'],
    content: (Array.isArray(m.content) ? m.content : []) as StoredBlock[],
    uploadIds: [],
    toolCalls: (m.tool_calls ?? null) as StoredMessage['toolCalls'],
    createdAt: new Date(String(m.created_at)).toISOString(),
  };
}

export class SupabaseParentStore implements ParentChatStore, ParentRpc {
  readonly kind = 'supabase' as const;

  constructor(
    private readonly db: ParentDbClient,
    /** Sunucu anahtarı (OGRENMEN_WEB_COACH_KEY); tarayıcıya gitmez. */
    private readonly key: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  token(conversationId: string): string {
    return mintServerToken(this.key, conversationId, this.now());
  }

  async call(fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) throw new ParentRpcError(fn, error.code ?? null, error.message);
    return data;
  }

  async openConversation(studentId: string, fresh: boolean): Promise<string> {
    return String(await this.call('parent_open_conversation', { p_student: studentId, p_new: fresh }));
  }

  async history(opts: { conversationId: string | null; studentId: string | null; limit: number; afterId?: number | null }): Promise<ParentHistory | null> {
    let raw: unknown;
    try {
      raw = await this.call('parent_history', { p_conversation: opts.conversationId, p_limit: opts.limit, p_after_id: opts.afterId ?? null, p_student: opts.studentId });
    } catch (err) {
      if (err instanceof ParentRpcError && err.forbidden) return null;
      throw err;
    }
    const h = obj(raw);
    const c = h.conversation ? obj(h.conversation) : null;
    const conversation: ParentConversation | null = c
      ? {
          id: String(c.id),
          studentId: String(c.student_id),
          summary: typeof c.summary === 'string' ? c.summary : null,
          summaryUptoMessageId: num(c.summary_upto_message_id),
          turnInProgress: c.turn_in_progress === true,
        }
      : null;
    return { conversation, total: Number(h.total ?? 0), messages: Array.isArray(h.messages) ? h.messages.map((m) => message(obj(m))) : [] };
  }

  async claimTurn(conversationId: string): Promise<TurnClaim | null> {
    const token = await this.call('parent_claim_turn', { p_conversation: conversationId, p_ttl_s: PARENT_TURN_LEASE_S });
    if (!token) return null;
    let done = false;
    return {
      release: async () => {
        if (done) return;
        done = true;
        await this.call('parent_release_turn', { p_conversation: conversationId, p_token: token });
      },
    };
  }

  async appendMessages(
    conversationId: string,
    rows: { role: StoredMessage['role']; content: StoredBlock[]; llmCallId?: number | null; toolCalls?: ParentTurnRecord | null }[],
  ): Promise<number[]> {
    const ids: number[] = [];
    for (const m of rows) {
      const id = await this.call('parent_append_message', {
        p_conversation: conversationId,
        p_role: m.role,
        p_content: m.content,
        p_llm_call_id: m.llmCallId ?? null,
        p_tool_calls: m.toolCalls ?? null,
        p_server_token: this.token(conversationId),
      });
      ids.push(Number(id));
    }
    return ids;
  }

  async childContext(studentId: string): Promise<string | null> {
    try {
      return childContextText(await this.call('parent_child_summary', { p_student: studentId }));
    } catch (err) {
      console.warn('OGR-PARENT-022 çocuk özeti okunamadı', err instanceof ParentRpcError ? err.code : err);
      return null;
    }
  }

  toolRunners(studentId: string, onReport: (ref: ReportRef) => void): ToolRunners {
    return parentToolRunners(this, studentId, onReport);
  }

  ledger(): LedgerWriter {
    return new ParentLedger(this);
  }
}

/** Defter: `parent_log_llm_call` (sunucu jetonu; satır sohbete bağlı). Yazma hatası turu düşürmez. */
export class ParentLedger implements LedgerWriter {
  constructor(private readonly store: SupabaseParentStore) {}

  async write(row: LedgerRow): Promise<number | null> {
    try {
      if (row.ref_table !== 'conversations' || !row.ref_id) throw new Error('veli defter satırı sohbete bağlı olmalı (ref conversations)');
      const id = await this.store.call('parent_log_llm_call', { p_conversation: row.ref_id, p_call: toLedgerRecord(row), p_server_token: this.store.token(row.ref_id) });
      return id === null || id === undefined ? null : Number(id);
    } catch (err) {
      console.error('OGR-LLM-009 llm_calls yazılamadı (veli)', err);
      return null;
    }
  }
}

/** Bellek deposunun örnek çocuğu (yalnız sahte kip). */
export const DEMO_CHILD_ID = '00000000-0000-4000-8000-00000000c0de';
export const DEMO_SUMMARY = {
  week: { start: '2026-11-02', minutes: 270, questions: 38, active_days: 4, exams: 1 },
  prev_week: { start: '2026-10-26', minutes: 120, questions: 20, active_days: 2, exams: 0 },
  last_exam: { session_id: '00000000-0000-4000-8000-0000000e0001', title: 'TYT Deneme 3', finished_at: '2026-11-05T15:00:00Z', net: 21.75, total: 40, correct: 24, wrong: 9, blank: 7 },
  courses: [{ course_id: '00000000-0000-4000-8000-0000000c0001', title: 'TYT Matematik', bands: { low: 2, mid: 5, high: 3, insufficient: 12 }, trend: 'up' }],
  open_misconceptions: 2,
  latest_report: null,
  last_activity_at: '2026-11-07T18:00:00Z',
};

export class MemoryParentStore implements ParentChatStore, ParentRpc {
  readonly kind = 'memory' as const;
  private readonly conversations = new Map<string, { studentId: string; messages: StoredMessage[]; turn: boolean }>();
  private seq = 0;
  private readonly memLedger = new InMemoryLedger();
  readonly reports: ReportRef[] = [];

  constructor(private readonly children: readonly string[] = [DEMO_CHILD_ID]) {}

  private assertChild(studentId: string): void {
    if (!this.children.includes(studentId)) throw new ParentRpcError('parent_open_conversation', '42501', 'OGR-AUTH-001 bu öğrenci için veli yetkisi yok');
  }

  async call(fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (args.p_student !== undefined) this.assertChild(String(args.p_student));
    switch (fn) {
      case 'parent_child_summary':
        return DEMO_SUMMARY;
      case 'parent_mastery_overview':
        return { min_evidence: 5, courses: [{ ...DEMO_SUMMARY.courses[0], skills: [{ skill_id: 'tyt.mat.temel.rasyonel-sayilar', name: 'Rasyonel sayılar', unit: 'Sayılar', band: 'mid', evidence_count: 12 }] }] };
      case 'parent_recent_activity':
        return { days: args.p_days ?? 7, per_day: [{ date: '2026-11-07', minutes: 45, questions: 12 }], items: [] };
      case 'parent_exam_sessions':
        return [{ session_id: DEMO_SUMMARY.last_exam.session_id, title: 'TYT Deneme 3', status: 'done', finished_at: '2026-11-05T15:00:00Z', score: { total: 40, correct: 24, wrong: 9, blank: 7, net: 21.75, sections: [] }, report_ready: false }];
      case 'parent_reports':
        return this.reports.map((r) => ({ id: r.documentId, title: r.title, report_kind: r.kind, status: 'queued', ready: false, created_at: new Date().toISOString(), requested_by_me: true }));
      case 'parent_request_report': {
        if (this.reports.length >= 3) throw new ParentRpcError(fn, 'P0001', 'OGR-REPORT-002 bugünkü rapor sınırı doldu (3)');
        const ref = { documentId: `00000000-0000-4000-8000-${String(this.reports.length + 1).padStart(12, '0')}`, title: 'Haftalık rapor', kind: String(args.p_kind) };
        this.reports.push(ref);
        return { document_id: ref.documentId, title: ref.title, report_kind: ref.kind, status: 'queued', used: this.reports.length, max: 3 };
      }
      default:
        throw new ParentRpcError(fn, '42883', 'bilinmeyen işlev');
    }
  }

  async openConversation(studentId: string, fresh: boolean): Promise<string> {
    this.assertChild(studentId);
    if (!fresh) {
      const last = [...this.conversations.entries()].reverse().find(([, c]) => c.studentId === studentId);
      if (last) return last[0];
    }
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`;
    this.conversations.set(id, { studentId, messages: [], turn: false });
    return id;
  }

  async history(opts: { conversationId: string | null; studentId: string | null; limit: number; afterId?: number | null }): Promise<ParentHistory | null> {
    let id = opts.conversationId;
    if (!id) id = [...this.conversations.entries()].reverse().find(([, c]) => !opts.studentId || c.studentId === opts.studentId)?.[0] ?? null;
    if (!id) return { conversation: null, total: 0, messages: [] };
    const c = this.conversations.get(id);
    if (!c || (opts.studentId && c.studentId !== opts.studentId)) return null;
    const after = c.messages.filter((m) => m.id > (opts.afterId ?? 0));
    return {
      conversation: { id, studentId: c.studentId, summary: null, summaryUptoMessageId: null, turnInProgress: c.turn },
      total: after.length,
      messages: opts.limit > 0 ? after.slice(-opts.limit) : [],
    };
  }

  async claimTurn(conversationId: string): Promise<TurnClaim | null> {
    const c = this.conversations.get(conversationId);
    if (!c || c.turn) return null;
    c.turn = true;
    return { release: async () => void (c.turn = false) };
  }

  async appendMessages(conversationId: string, rows: { role: StoredMessage['role']; content: StoredBlock[]; toolCalls?: ParentTurnRecord | null }[]): Promise<number[]> {
    const c = this.conversations.get(conversationId)!;
    return rows.map((r) => {
      const id = c.messages.length + 1 + this.seq * 1000;
      c.messages.push({ id, role: r.role, content: r.content, uploadIds: [], toolCalls: (r.toolCalls ?? null) as StoredMessage['toolCalls'], createdAt: new Date().toISOString() });
      return id;
    });
  }

  async childContext(studentId: string): Promise<string | null> {
    return childContextText(await this.call('parent_child_summary', { p_student: studentId }));
  }

  toolRunners(studentId: string, onReport: (ref: ReportRef) => void): ToolRunners {
    return parentToolRunners(this, studentId, onReport);
  }

  ledger(): LedgerWriter {
    return this.memLedger;
  }
}
