/**
 * FakeDb: fixtures/db/dev-seed.json'dan bellek içi tablolar ve §3.9 RPC'lerinin eşlenikleri.
 *
 * - RLS taklidi: öğrenci satırına dokunan her çağrı `forStudent(id)` kapsamı ister; başlıksız çağrı
 *   `OGR-AUTH-001`, başka öğrencinin kaydı `OGR-AUTH-004` fırlatır (Worker'daki bir kod hatası başka
 *   öğrencinin satırını okuyamaz).
 * - Ustalık güncellemesi `@ogrenmen/mastery-math` ile (SQL `apply_observation` ile aynı dallar).
 * - `secure` şeması bu sınıfın dışından okunmaz: cevap anahtarı denetimi enjekte edilen
 *   `AnswerOracle` ile yapılır (canlıda `grade_attempt` SECURITY DEFINER gövdesi). Oracle verilmezse
 *   `grade_attempt` `OGR-GRADE-004` ile açık hata verir — anahtarsız "her cevap yanlış" sessizliği yok.
 * - Seed verisi kurucu parametresidir; bu modül fixtures dosyasını kendisi içe almaz.
 */
import { observationStep, type ObservationKind } from '@ogrenmen/mastery-math';
import { nameTokenHashes, sha256Hex } from '@ogrenmen/pii';
import { addDays, istanbulDay, istanbulHour, uuidFrom } from '../util.ts';
import {
  DbError,
  type ApprovedFact,
  type AutoAnswerRow,
  type ChatKind,
  type ChatRoleRow,
  type Db,
  type DiagnosticItem,
  type DiagnosticResult,
  type EnrollmentRow,
  type EscalationReason,
  type GradeResult,
  type Identity,
  type LegalText,
  type MasteryViewRow,
  type MemoryHit,
  type MessageInsert,
  type MessageRow,
  type ObservationContext,
  type OpsAlertInput,
  type PoolCandidate,
  type PoolRow,
  type PracticeItem,
  type PreferencesRow,
  type PriorityPlan,
  type PriorityPlanRow,
  type ProactiveRow,
  type PromptProfile,
  type ProviderHealthRow,
  type PublicOption,
  type QuestionPublic,
  type QuotaLimitRow,
  type QuotaResult,
  type QuotaUsageRow,
  type RecentMessage,
  type ResearchRelease,
  type ResolveArgs,
  type SessionAttemptStats,
  type SessionRow,
  type SpendLedgerRow,
  type SpendState,
  type StaffHandle,
  type StorageDeletion,
  type TgChatRow,
} from './repo.ts';

/** Cevap anahtarı kapısı (canlıda `secure.answer_keys` yalnız SECURITY DEFINER gövdesinde okunur). */
export interface AnswerOracle {
  /** null: bu soru için anahtar yok. */
  verdict(questionId: string, chosen: { key?: string; value?: string }): boolean | null;
  solution(questionId: string): string | null;
}

export interface FakeDbOptions {
  clock: { now(): Date };
  random: () => number;
  oracle?: AnswerOracle;
}

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const IDENTITY_TABLES = [
  'messages',
  'bot_responses',
  'llm_calls',
  'observations',
  'attempts',
  'mastery_history',
  'memory_facts',
  'quota_usage',
  'retention_runs',
  'storage_deletions',
  'audit.events',
] as const;

const BOT_FLAG_KEYS = new Set(['alerts_sent', 'degraded_mode', 'facts_lag_days', 'storage_pressure']);
const BINARY_KINDS = new Set(['diagnostic', 'practice', 'test', 'resolution']);
const MB = 1024 * 1024;

function num(v: unknown, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d;
}
function s(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function clone<T>(x: T): T {
  return structuredClone(x);
}
function fold(text: string): string {
  return text.toLocaleLowerCase('tr-TR').replace(/[^a-zçğıöşü0-9 ]+/g, ' ');
}
/** Türkçe FTS taklidi: 5 harflik kök önekleri (ts_rank yerine örtüşme oranı). */
function stems(text: string): Set<string> {
  return new Set(
    fold(text)
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .map((w) => w.slice(0, 5)),
  );
}

export class FakeDb implements Db {
  readonly student: string | null;
  /** Ortak durum: tüm kapsam kopyaları aynı tabloları paylaşır. */
  private readonly shared: { t: Tables; seq: Record<string, number>; calls: string[]; sizeOverride: number | null; payloads: Array<Record<string, unknown>> };
  private readonly opts: FakeDbOptions;

  constructor(seed: Record<string, unknown>, opts: FakeDbOptions, student: string | null = null, shared?: FakeDb['shared']) {
    this.opts = opts;
    this.student = student;
    if (shared) {
      this.shared = shared;
      return;
    }
    const t: Tables = {};
    for (const [k, v] of Object.entries(clone(seed))) if (Array.isArray(v)) t[k] = v as Row[];
    for (const k of ['tg_updates', 'storage_deletions', 'retention_runs', 'audit.events', 'table_sizes_daily', 'research_requests', 'proactive_messages']) t[k] ??= [];
    const seq: Record<string, number> = {};
    for (const k of IDENTITY_TABLES) seq[k] = Math.max(0, ...(t[k] ?? []).map((r) => num(r.id)));
    this.shared = { t, seq, calls: [], sizeOverride: null, payloads: [] };
  }

  // ---------------------------------------------------------------- test yardımcıları
  /** Tablo satırları (canlı başvuru; testler doğrudan okur/değiştirir). */
  table(name: string): Row[] {
    return (this.shared.t[name] ??= []);
  }
  /** Çağrılan RPC adları (sıra korunur). */
  get rpcCalls(): readonly string[] {
    return this.shared.calls;
  }
  /** `llm_calls` satırı + `app.spend_rollup()` tetikleyicisi. */
  addLlmCall(row: { purpose: string; provider: string; model: string; cost_usd: number; tokens_in?: number; tokens_out?: number; status?: string; created_at?: string }): void {
    const created = row.created_at ?? this.nowIso();
    const full: Row = {
      id: this.nextId('llm_calls'),
      purpose: row.purpose,
      provider: row.provider,
      model: row.model,
      tokens_in: row.tokens_in ?? 0,
      tokens_out: row.tokens_out ?? 0,
      batch: false,
      status: row.status ?? 'ok',
      error_code: null,
      latency_ms: null,
      cost_usd: row.cost_usd,
      ref_table: null,
      ref_id: null,
      student_ref: null,
      created_at: created,
    };
    this.table('llm_calls').push(full);
    this.spendRollup(full);
  }
  /** `compute_table_sizes` için sahte toplam boyut (bayt). */
  setSizeOverride(bytes: number | null): void {
    this.shared.sizeOverride = bytes;
  }

  forStudent(studentId: string | null): Db {
    return new FakeDb({}, this.opts, studentId, this.shared);
  }

  // ---------------------------------------------------------------- iç yardımcılar
  private get t(): Tables {
    return this.shared.t;
  }
  private now(): Date {
    return this.opts.clock.now();
  }
  private nowIso(): string {
    return this.now().toISOString();
  }
  private today(): string {
    return istanbulDay(this.now());
  }
  private uuid(): string {
    return uuidFrom(this.opts.random);
  }
  private nextId(table: string): number {
    const v = (this.shared.seq[table] ?? 0) + 1;
    this.shared.seq[table] = v;
    return v;
  }
  private rpc(name: string): void {
    this.shared.calls.push(name);
  }
  private requireStudent(): string {
    if (this.student === null) throw new DbError('OGR-AUTH-001', 'öğrenci başlığı yok', 403);
    return this.student;
  }
  private enrollmentStudent(eid: string): string | null {
    return s(this.table('enrollments').find((e) => e.id === eid)?.student_id);
  }
  private requireEnrollment(eid: string): string {
    const sid = this.requireStudent();
    if (this.enrollmentStudent(eid) !== sid) throw new DbError('OGR-AUTH-004', 'başka öğrenci', 403);
    return sid;
  }
  private setting(key: string): unknown {
    return this.table('settings').find((r) => r.key === key)?.value;
  }
  private flag(key: string): unknown {
    return this.table('runtime_flags').find((r) => r.key === key)?.value;
  }
  private audit(action: string, table: string, rowId: string | null, diff: unknown = null): void {
    this.table('audit.events').push({ id: this.nextId('audit.events'), at: this.nowIso(), actor_role: 'bot_runtime', actor_id: null, action, table_name: table, row_id: rowId, diff });
  }
  private consentOk(studentId: string): boolean {
    const given = (kind: string): boolean => this.table('consents').some((c) => c.student_id === studentId && c.kind === kind && c.status === 'given');
    const st = this.table('students').find((x) => x.id === studentId);
    return given('kvkk_aydinlatma') && (st?.is_minor === false || given('veli_onayi'));
  }
  private refreshStatus(studentId: string): void {
    const st = this.table('students').find((x) => x.id === studentId);
    if (st && st.status !== 'deleted') st.status = this.consentOk(studentId) ? 'active' : 'pending_consent';
  }
  private skill(curriculumId: string, skillId: string): Row | undefined {
    return this.table('skills').find((k) => k.curriculum_id === curriculumId && k.id === skillId);
  }
  private enrollmentCurriculum(eid: string): string {
    return String(this.table('enrollments').find((e) => e.id === eid)?.curriculum_id ?? '');
  }
  private stripTags(options: unknown): PublicOption[] {
    if (!Array.isArray(options)) return [];
    return (options as Row[]).map((o) => ({ key: String(o.key), text: String(o.text) })).sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  private minEvidence(): number {
    return num(this.setting('min_evidence'), 5);
  }
  private messageVisible(m: Row): boolean {
    if (this.student === null) return false;
    if (m.student_id === this.student) return true;
    return (
      ['bot', 'instructor', 'coordinator'].includes(String(m.sender_role)) &&
      this.table('chat_roles').some((cr) => cr.chat_id === m.chat_id && cr.student_id === this.student)
    );
  }

  // ---------------------------------------------------------------- giriş, sohbet kaydı
  async dedupUpdate(updateId: number): Promise<boolean> {
    this.rpc('dedup_update');
    const rows = this.table('tg_updates');
    if (rows.some((r) => r.update_id === updateId)) return false;
    rows.push({ update_id: updateId, received_at: this.nowIso() });
    return true;
  }

  async upsertChat(row: { chat_id: number; kind: ChatKind; title: string | null }): Promise<TgChatRow> {
    const rows = this.table('tg_chats');
    let r = rows.find((c) => c.chat_id === row.chat_id);
    if (!r) {
      r = {
        chat_id: row.chat_id,
        kind: row.kind,
        title: row.title,
        bot_is_admin: false,
        bot_can_pin: false,
        recording_notice_msg_id: null,
        recording_notice_legal_id: null,
        privacy_mode_off_verified: false,
        retention_days: 90,
        recording_notice_days: null,
        group_auto_answer_min: 0,
        created_at: this.nowIso(),
      };
      rows.push(r);
    } else if (row.title !== null) {
      r.title = row.title;
    }
    return clone(r) as unknown as TgChatRow;
  }

  async getChat(chatId: number): Promise<TgChatRow | null> {
    const r = this.table('tg_chats').find((c) => c.chat_id === chatId);
    return r ? (clone(r) as unknown as TgChatRow) : null;
  }

  async updateChat(chatId: number, patch: Partial<TgChatRow>): Promise<void> {
    const r = this.table('tg_chats').find((c) => c.chat_id === chatId);
    if (r) Object.assign(r, patch);
  }

  async chatsWithStaleNotice(): Promise<TgChatRow[]> {
    return this.table('tg_chats')
      .filter((c) => c.kind !== 'private' && c.recording_notice_days !== c.retention_days)
      .map((c) => clone(c) as unknown as TgChatRow);
  }

  async getChatRole(chatId: number, tgUserId: number): Promise<ChatRoleRow | null> {
    const r = this.table('chat_roles').find((c) => c.chat_id === chatId && c.telegram_user_id === tgUserId);
    return r ? (clone(r) as unknown as ChatRoleRow) : null;
  }

  async upsertChatRole(row: Omit<ChatRoleRow, 'joined_at'> & { joined_at?: string }): Promise<void> {
    const rows = this.table('chat_roles');
    const r = rows.find((c) => c.chat_id === row.chat_id && c.telegram_user_id === row.telegram_user_id);
    if (r) Object.assign(r, { ...row, joined_at: row.joined_at ?? r.joined_at });
    else rows.push({ ...row, joined_at: row.joined_at ?? this.nowIso() });
  }

  async chatStaff(chatId: number): Promise<StaffHandle[]> {
    const out: StaffHandle[] = [];
    for (const cr of this.table('chat_roles')) {
      if (cr.chat_id !== chatId || cr.staff_id === null || cr.staff_id === undefined) continue;
      // PostgrestDb ile aynı: bot_runtime `staff.active` sütununu okuyamaz (§3.8); bağ chat_roles'tadır.
      const st = this.table('staff').find((x) => x.id === cr.staff_id);
      if (!st) continue;
      out.push({
        staff_id: String(st.id),
        role: st.role as StaffHandle['role'],
        subject: s(st.subject),
        mention_handle: s(cr.mention_handle),
        telegram_user_id: num(cr.telegram_user_id),
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- kimlik ve onay
  async resolveTelegram(a: ResolveArgs): Promise<Identity> {
    this.rpc('resolve_telegram');
    const ids = this.table('secure.telegram_identities');
    const ti = ids.find((x) => x.telegram_user_id === a.tgUser);
    let sid = s(ti?.student_id);
    const stf = s(ti?.staff_id);
    const name = [a.firstName ?? '', a.lastName ?? ''].join(' ').trim() || null;
    if (sid === null && stf === null && !a.isGroup && a.create) {
      const cur = this.table('curricula')
        .filter((c) => c.status === 'active')
        .sort((x, y) => num(y.year) - num(x.year) || String(y.version).localeCompare(String(x.version)))[0];
      const period = this.setting('default_period');
      if (!cur || typeof period !== 'string') throw new DbError('OGR-ENR-001', 'aktif müfredat yok');
      sid = this.uuid();
      let ref = 's_';
      const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
      for (let i = 0; i < 12; i++) ref += alphabet[Math.floor(this.opts.random() * 32)];
      this.table('students').push({ id: sid, public_ref: ref, is_minor: true, tz: 'Europe/Istanbul', tier: 'standard', status: 'pending_consent', created_at: this.nowIso(), deleted_at: null });
      this.table('secure.student_pii').push({
        student_id: sid,
        display_name: name,
        birth_year: null,
        school: null,
        grade: null,
        guardian_name: null,
        guardian_relation: null,
        guardian_contact: null,
        name_token_hashes: name === null ? [] : nameTokenHashes(name),
        updated_at: this.nowIso(),
      });
      ids.push({ telegram_user_id: a.tgUser, student_id: sid, staff_id: null, username: a.username, mention_handle: null, linked_at: this.nowIso() });
      this.table('preferences').push({ student_id: sid, active_hours: [18, 19, 20, 21], modality: null, default_mode: 'socratic', explanation_notes: null, proactive_enabled: true, voice_reply: false, updated_at: this.nowIso() });
      this.table('enrollments').push({ id: this.uuid(), student_id: sid, curriculum_id: cur.id, period_label: period, status: 'active', started_at: this.today(), ended_at: null });
    }
    let eid: string | null = null;
    if (sid !== null) {
      const ident = ids.find((x) => x.telegram_user_id === a.tgUser);
      if (ident && a.username !== null) ident.username = a.username;
      const pii = this.table('secure.student_pii').find((p) => p.student_id === sid);
      if (pii && pii.display_name === null && name !== null) {
        pii.display_name = name;
        pii.name_token_hashes = nameTokenHashes(name);
      }
      const enr = this.table('enrollments')
        .filter((e) => e.student_id === sid && e.status === 'active')
        .sort((x, y) => String(y.started_at).localeCompare(String(x.started_at)))[0];
      eid = s(enr?.id);
      const roles = this.table('chat_roles');
      if (!roles.some((c) => c.chat_id === a.chat && c.telegram_user_id === a.tgUser)) {
        roles.push({ chat_id: a.chat, telegram_user_id: a.tgUser, role: 'student', student_id: sid, staff_id: null, mention_handle: null, joined_at: this.nowIso() });
      }
    } else if (stf !== null) {
      const st = this.table('staff').find((x) => x.id === stf);
      if (st) {
        const handle = s(ti?.mention_handle) ?? (a.username === null ? null : '@' + a.username);
        const roles = this.table('chat_roles');
        const cr = roles.find((c) => c.chat_id === a.chat && c.telegram_user_id === a.tgUser);
        if (cr) Object.assign(cr, { role: st.role, staff_id: st.id, mention_handle: handle ?? cr.mention_handle });
        else roles.push({ chat_id: a.chat, telegram_user_id: a.tgUser, role: st.role, student_id: null, staff_id: st.id, mention_handle: handle, joined_at: this.nowIso() });
      }
    }
    const cr = this.table('chat_roles').find((c) => c.chat_id === a.chat && c.telegram_user_id === a.tgUser);
    if (sid !== null) {
      const st = this.table('students').find((x) => x.id === sid);
      const tier = this.table('quota_tiers').find((q) => q.tier === st?.tier);
      return {
        student_id: sid,
        public_ref: s(st?.public_ref),
        is_minor: st?.is_minor === true,
        status: s(st?.status),
        enrollment_id: eid,
        consent_ok: this.consentOk(sid),
        role_in_chat: (s(cr?.role) as Identity['role_in_chat']) ?? null,
        staff_id: stf,
        tier: s(st?.tier),
        service_level: (s(tier?.service_level) as Identity['service_level']) ?? null,
      };
    }
    return {
      student_id: null,
      public_ref: null,
      is_minor: null,
      status: null,
      enrollment_id: null,
      consent_ok: false,
      role_in_chat: cr ? (cr.role as Identity['role_in_chat']) : null,
      staff_id: cr ? stf : null,
      tier: null,
      service_level: null,
    };
  }

  async recordStudentConsent(kind: 'kvkk_aydinlatma' | 'grup_kayit', legalTextId: string, evidence: Record<string, unknown>): Promise<string> {
    this.rpc('record_student_consent');
    const sid = this.requireStudent();
    if (kind !== 'kvkk_aydinlatma' && kind !== 'grup_kayit') throw new DbError('OGR-CONS-001', 'bu onay türü botla verilemez');
    if (evidence.chat_id === undefined || evidence.chat_id === null || evidence.message_id === undefined || evidence.message_id === null) {
      throw new DbError('OGR-CONS-002', 'kanıt eksik');
    }
    const rows = this.table('consents');
    let c = rows.find((x) => x.student_id === sid && x.kind === kind && x.status === 'given');
    if (c) Object.assign(c, { legal_text_id: legalTextId, evidence, given_at: this.nowIso() });
    else {
      c = { id: this.uuid(), student_id: sid, kind, legal_text_id: legalTextId, status: 'given', method: 'telegram_button', given_by: 'student', evidence, given_at: this.nowIso(), revoked_at: null, created_at: this.nowIso() };
      rows.push(c);
    }
    this.refreshStatus(sid);
    return String(c.id);
  }

  async redeemGuardianCode(code: string, guardianTg: number, evidence: Record<string, unknown>): Promise<boolean> {
    this.rpc('redeem_guardian_code');
    const hash = sha256Hex(code.replace(/-/g, '').toUpperCase());
    const gc = this.table('secure.guardian_codes').find(
      (g) => g.code_hash === hash && g.channel === 'telegram' && (g.used_at === null || g.used_at === undefined) && Date.parse(String(g.expires_at)) > this.now().getTime(),
    );
    if (!gc) return false;
    if (this.table('secure.telegram_identities').some((ti) => ti.telegram_user_id === guardianTg && ti.student_id === gc.student_id)) {
      throw new DbError('OGR-CONS-003', 'öğrenci kendi velisi olamaz');
    }
    const lt = this.table('legal_texts')
      .filter((l) => l.kind === 'veli_onayi')
      .sort((x, y) => String(y.effective_from).localeCompare(String(x.effective_from)))[0];
    gc.used_at = this.nowIso();
    gc.used_by_telegram_user_id = guardianTg;
    const sid = String(gc.student_id);
    this.table('consents').push({
      id: this.uuid(),
      student_id: sid,
      kind: 'veli_onayi',
      legal_text_id: lt?.id ?? null,
      status: 'given',
      method: 'guardian_code',
      given_by: 'guardian',
      evidence: { ...evidence, code_id: gc.id },
      given_at: this.nowIso(),
      revoked_at: null,
      created_at: this.nowIso(),
    });
    this.refreshStatus(sid);
    this.audit('RPC:redeem_guardian_code', 'consents', sid);
    return true;
  }

  async redeemStaffCode(code: string, tgUser: number, username: string): Promise<boolean> {
    this.rpc('redeem_staff_code');
    const hash = sha256Hex(code.replace(/-/g, '').toUpperCase());
    const sc = this.table('secure.staff_codes').find(
      (g) => g.code_hash === hash && (g.used_at === null || g.used_at === undefined) && Date.parse(String(g.expires_at)) > this.now().getTime(),
    );
    if (!sc) return false;
    const ids = this.table('secure.telegram_identities');
    if (ids.some((ti) => ti.telegram_user_id === tgUser && ti.student_id !== null && ti.student_id !== undefined)) {
      throw new DbError('OGR-STAFF-002', 'bu Telegram hesabı bir öğrenciye bağlı');
    }
    const staff = this.table('staff').find((x) => x.id === sc.staff_id && x.active === true);
    if (!staff) throw new DbError('OGR-STAFF-001', 'personel yok');
    const handle = '@' + username;
    const ti = ids.find((x) => x.telegram_user_id === tgUser);
    if (ti) Object.assign(ti, { staff_id: staff.id, username, mention_handle: handle, linked_at: this.nowIso() });
    else ids.push({ telegram_user_id: tgUser, student_id: null, staff_id: staff.id, username, mention_handle: handle, linked_at: this.nowIso() });
    for (const cr of this.table('chat_roles')) {
      if (cr.telegram_user_id === tgUser) Object.assign(cr, { role: staff.role, staff_id: staff.id, student_id: null, mention_handle: handle });
    }
    sc.used_at = this.nowIso();
    sc.used_by_telegram_user_id = tgUser;
    this.audit('RPC:redeem_staff_code', 'staff', String(staff.id));
    return true;
  }

  async setBirthYear(year: number): Promise<boolean> {
    this.rpc('set_birth_year');
    const sid = this.requireStudent();
    const pii = this.table('secure.student_pii').find((p) => p.student_id === sid);
    if (pii) {
      pii.birth_year = year;
      pii.updated_at = this.nowIso();
    }
    const minor = this.now().getUTCFullYear() - year < 18;
    const st = this.table('students').find((x) => x.id === sid);
    if (st) st.is_minor = minor;
    this.refreshStatus(sid);
    return minor;
  }

  async nameTokenHashes(chatId: number): Promise<string[]> {
    this.rpc('name_token_hashes');
    const out = new Set<string>();
    for (const cr of this.table('chat_roles')) {
      if (cr.chat_id !== chatId) continue;
      if (cr.student_id) {
        const pii = this.table('secure.student_pii').find((p) => p.student_id === cr.student_id);
        for (const h of (pii?.name_token_hashes as string[] | undefined) ?? []) out.add(h);
      }
      if (cr.staff_id) {
        const st = this.table('staff').find((x) => x.id === cr.staff_id);
        if (st && typeof st.full_name === 'string') for (const h of nameTokenHashes(st.full_name)) out.add(h);
      }
    }
    return [...out].sort();
  }

  async requestDeletion(): Promise<void> {
    this.rpc('request_deletion');
    const sid = this.requireStudent();
    const st = this.table('students').find((x) => x.id === sid);
    if (st) Object.assign(st, { status: 'deleted', deleted_at: this.nowIso() });
    const coord = this.table('staff').find((x) => x.role === 'coordinator' && x.active === true);
    this.table('escalations').push({
      id: this.uuid(),
      chat_id: 0,
      message_id: null,
      student_id: sid,
      reason: 'deletion_request',
      question_text: null,
      target_staff_id: coord?.id ?? null,
      status: 'open',
      created_at: this.nowIso(),
      answered_at: null,
      answered_by: null,
    });
  }

  async getEnrollment(enrollmentId: string): Promise<EnrollmentRow | null> {
    const sid = this.requireStudent();
    const e = this.table('enrollments').find((x) => x.id === enrollmentId && x.student_id === sid);
    return e ? { id: String(e.id), student_id: sid, curriculum_id: String(e.curriculum_id), period_label: String(e.period_label) } : null;
  }

  async identityForStudent(chatId: number): Promise<Identity> {
    const sid = this.requireStudent();
    this.rpc('consent_ok');
    const st = this.table('students').find((x) => x.id === sid);
    const enr = this.table('enrollments')
      .filter((e) => e.student_id === sid && e.status === 'active')
      .sort((x, y) => String(y.started_at).localeCompare(String(x.started_at)))[0];
    const tier = this.table('quota_tiers').find((q) => q.tier === st?.tier);
    const cr = this.table('chat_roles').find((c) => c.chat_id === chatId && c.student_id === sid);
    return {
      student_id: sid,
      public_ref: s(st?.public_ref),
      is_minor: st?.is_minor === true,
      status: s(st?.status),
      enrollment_id: s(enr?.id),
      consent_ok: this.consentOk(sid),
      role_in_chat: (s(cr?.role) as Identity['role_in_chat']) ?? 'student',
      staff_id: null,
      tier: s(st?.tier),
      service_level: (s(tier?.service_level) as Identity['service_level']) ?? null,
    };
  }

  // ---------------------------------------------------------------- ayarlar
  async settings(): Promise<Record<string, unknown>> {
    return Object.fromEntries(this.table('settings').map((r) => [String(r.key), clone(r.value)]));
  }
  async runtimeFlags(): Promise<Record<string, unknown>> {
    return Object.fromEntries(this.table('runtime_flags').map((r) => [String(r.key), clone(r.value)]));
  }
  async setRuntimeFlag(key: string, value: unknown): Promise<void> {
    this.rpc('set_runtime_flag');
    if (!BOT_FLAG_KEYS.has(key)) throw new DbError('OGR-AUTH-003', `bot_runtime ${key} anahtarını değiştiremez`, 403);
    const rows = this.table('runtime_flags');
    const r = rows.find((x) => x.key === key);
    if (r) Object.assign(r, { value: clone(value), updated_at: this.nowIso(), updated_by: 'bot_runtime:' });
    else rows.push({ key, value: clone(value), updated_at: this.nowIso(), updated_by: 'bot_runtime:' });
    this.audit('RPC:set_runtime_flag', 'runtime_flags', key, value);
  }
  async latestLegalText(kind: string): Promise<LegalText | null> {
    const r = this.table('legal_texts')
      .filter((l) => l.kind === kind)
      .sort((x, y) => String(y.effective_from).localeCompare(String(x.effective_from)))[0];
    return r ? { id: String(r.id), kind, version: String(r.version), body_md: String(r.body_md) } : null;
  }
  async curriculumSkills(curriculumId: string): Promise<Array<{ id: string; name: string }>> {
    return this.table('skills')
      .filter((k) => k.curriculum_id === curriculumId && k.is_leaf === true)
      .map((k) => ({ id: String(k.id), name: String(k.name) }));
  }
  async misconceptionText(tag: string): Promise<string | null> {
    return s(this.table('misconception_tags').find((m) => m.tag === tag)?.text_student);
  }

  // ---------------------------------------------------------------- oturum ve tercih
  async getSession(chatId: number): Promise<SessionRow | null> {
    const sid = this.requireStudent();
    const r = this.table('sessions').find((x) => x.student_id === sid && x.chat_id === chatId);
    return r ? (clone(r) as unknown as SessionRow) : null;
  }
  async upsertSession(row: Partial<SessionRow> & { chat_id: number }): Promise<SessionRow> {
    const sid = this.requireStudent();
    const rows = this.table('sessions');
    let r = rows.find((x) => x.student_id === sid && x.chat_id === row.chat_id);
    if (!r) {
      r = {
        student_id: sid,
        chat_id: row.chat_id,
        state: 'new',
        mode: 'socratic',
        direct_once: false,
        pending_question_id: null,
        diagnostic_session_id: null,
        hint_level: 0,
        last_activity_at: this.nowIso(),
        quota_warned_on: null,
      };
      rows.push(r);
    }
    Object.assign(r, { ...row, student_id: sid });
    return clone(r) as unknown as SessionRow;
  }
  async getPreferences(): Promise<PreferencesRow | null> {
    const sid = this.requireStudent();
    const r = this.table('preferences').find((x) => x.student_id === sid);
    return r ? (clone(r) as unknown as PreferencesRow) : null;
  }
  async updatePreferences(patch: Partial<Omit<PreferencesRow, 'student_id'>>): Promise<void> {
    const sid = this.requireStudent();
    const r = this.table('preferences').find((x) => x.student_id === sid);
    if (r) Object.assign(r, patch, { updated_at: this.nowIso() });
  }

  // ---------------------------------------------------------------- mesajlar
  async insertMessage(row: MessageInsert, opts: { returnId: boolean }): Promise<number | null> {
    const rows = this.table('messages');
    if (rows.some((m) => m.chat_id === row.chat_id && m.telegram_message_id === row.telegram_message_id)) {
      throw new DbError('23505', 'duplicate key value violates unique constraint "messages_chat_id_telegram_message_id_key"', 409);
    }
    const chat = this.table('tg_chats').find((c) => c.chat_id === row.chat_id);
    if (!chat) throw new DbError('23503', 'messages.chat_id → tg_chats yok', 409);
    const expires = new Date(Date.parse(row.sent_at) + num(chat.retention_days, 90) * 86_400_000).toISOString();
    const full: Row = { id: this.nextId('messages'), ...clone(row), answered_at: null, expires_at: expires, created_at: this.nowIso() };
    rows.push(full);
    if (!opts.returnId) return null;
    if (!this.messageVisible(full)) throw new DbError('42501', 'new row violates row-level security policy for table "messages"', 403);
    return num(full.id);
  }
  async lastPracticeSetId(chatId: number): Promise<string | null> {
    let best: { id: number; set: string } | null = null;
    for (const m of this.table('messages')) {
      if (m.chat_id !== chatId || m.sender_role !== 'bot' || !this.messageVisible(m)) continue;
      const att = (Array.isArray(m.attachments) ? (m.attachments as Row[]) : []).find((a) => a.kind === 'practice_set');
      if (att && typeof att.set_id === 'string' && (best === null || num(m.id) > best.id)) best = { id: num(m.id), set: att.set_id };
    }
    return best?.set ?? null;
  }
  async updateMessageText(chatId: number, telegramMessageId: number, patch: { text_raw: string | null; text_llm: string | null; is_question: boolean | null }): Promise<void> {
    const m = this.table('messages').find((x) => x.chat_id === chatId && x.telegram_message_id === telegramMessageId);
    if (m) Object.assign(m, patch);
  }
  async markMessageAnswered(messageId: number, at: string): Promise<void> {
    const m = this.table('messages').find((x) => x.id === messageId);
    if (m && (m.answered_at === null || m.answered_at === undefined)) m.answered_at = at;
  }
  async getMessage(messageId: number): Promise<MessageRow | null> {
    const m = this.table('messages').find((x) => x.id === messageId);
    if (!m || !this.messageVisible(m)) return null;
    const { text_raw: _raw, ...rest } = m;
    return { ...(clone(rest) as unknown as MessageRow), text_raw: null };
  }
  async recentMessages(chatId: number, n: number): Promise<RecentMessage[]> {
    this.rpc('recent_messages');
    const sid = this.student;
    const rows = this.table('messages');
    const chat = this.table('tg_chats').find((c) => c.chat_id === chatId);
    const own = new Set(rows.filter((x) => x.chat_id === chatId && x.student_id === sid && sid !== null).map((x) => x.telegram_message_id));
    return rows
      .filter((m) => m.chat_id === chatId && typeof m.text_llm === 'string')
      .filter(
        (m) =>
          (sid !== null && m.student_id === sid) ||
          (['bot', 'instructor', 'coordinator'].includes(String(m.sender_role)) &&
            (((m.reply_to_telegram_message_id === null || m.reply_to_telegram_message_id === undefined) && chat?.kind === 'private') ||
              own.has(m.reply_to_telegram_message_id))),
      )
      .sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)) || num(b.id) - num(a.id))
      .slice(0, n)
      .map((m) => ({ id: num(m.id), sender_role: String(m.sender_role), text: String(m.text_llm), sent_at: String(m.sent_at) }));
  }

  // ---------------------------------------------------------------- kota ve harcama
  private consume(owner: { student_id: string } | { staff_id: string }, lim: number, warnAt: number, kind: string): QuotaResult {
    const day = this.today();
    const rows = this.table('quota_usage');
    const isStudent = 'student_id' in owner;
    let r = rows.find((u) => u.day === day && u.kind === kind && (isStudent ? u.student_id === owner.student_id : u.staff_id === (owner as { staff_id: string }).staff_id));
    if (!r) {
      r = { id: this.nextId('quota_usage'), student_id: isStudent ? owner.student_id : null, staff_id: isStudent ? null : (owner as { staff_id: string }).staff_id, day, kind, used: 0, warned: false };
      rows.push(r);
    }
    const used = num(r.used);
    if (used >= lim) return { allowed: false, used, daily_limit: lim, remaining: 0, warn: false };
    r.used = used + 1;
    const remaining = lim - (used + 1);
    if (remaining === warnAt && r.warned !== true) {
      if (isStudent) r.warned = true;
      return { allowed: true, used: used + 1, daily_limit: lim, remaining, warn: true };
    }
    return { allowed: true, used: used + 1, daily_limit: lim, remaining, warn: isStudent ? false : remaining === warnAt };
  }

  async consumeQuota(kind: string): Promise<QuotaResult> {
    this.rpc('consume_quota');
    const sid = this.requireStudent();
    const st = this.table('students').find((x) => x.id === sid);
    const q = this.table('quota_limits').find((l) => l.tier === st?.tier && l.kind === kind);
    if (!q) throw new DbError('OGR-QUOTA-001', `kota tanımsız ${kind}`);
    return this.consume({ student_id: sid }, num(q.daily_limit), num(q.warn_at_remaining, 5), kind);
  }

  async consumeStaffQuota(chatId: number, tgUser: number, kind: string): Promise<QuotaResult> {
    this.rpc('consume_staff_quota');
    const cr = this.table('chat_roles').find((c) => c.chat_id === chatId && c.telegram_user_id === tgUser);
    const stf = cr?.staff_id ? this.table('staff').find((x) => x.id === cr.staff_id && x.active === true) : undefined;
    if (!stf) throw new DbError('OGR-QUOTA-002', 'personel değil');
    const q = this.table('quota_limits').find((l) => l.tier === 'staff' && l.kind === kind);
    if (!q) throw new DbError('OGR-QUOTA-001', `kota tanımsız ${kind}`);
    return this.consume({ staff_id: String(stf.id) }, num(q.daily_limit), num(q.warn_at_remaining, 5), kind);
  }

  async quotaUsage(day: string): Promise<QuotaUsageRow[]> {
    const sid = this.requireStudent();
    return this.table('quota_usage')
      .filter((u) => u.student_id === sid && u.day === day)
      .map((u) => ({ kind: String(u.kind), used: num(u.used) }));
  }
  async quotaLimits(tier: string): Promise<QuotaLimitRow[]> {
    return this.table('quota_limits')
      .filter((l) => l.tier === tier)
      .map((l) => ({ kind: String(l.kind), daily_limit: num(l.daily_limit) }));
  }

  private spendRollup(call: Row): void {
    const day = istanbulDay(new Date(String(call.created_at)));
    const rows = this.table('spend_ledger');
    let r = rows.find((x) => x.day === day && x.purpose === call.purpose && x.provider === call.provider);
    if (!r) {
      r = { day, purpose: call.purpose, provider: call.provider, calls: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0 };
      rows.push(r);
    }
    r.calls = num(r.calls) + 1;
    r.tokens_in = num(r.tokens_in) + num(call.tokens_in);
    r.tokens_out = num(r.tokens_out) + num(call.tokens_out);
    r.cost_usd = Math.round((num(r.cost_usd) + num(call.cost_usd)) * 1e6) / 1e6;
  }

  async checkSpend(purpose: string): Promise<SpendState> {
    this.rpc('check_spend');
    const excluded = (this.flag('cap_excluded_purposes') as string[] | undefined) ?? [];
    const isLesson = excluded.includes(purpose);
    const today = this.today();
    const monthStart = today.slice(0, 8) + '01';
    let d = 0;
    let m = 0;
    let ml = 0;
    for (const r of this.table('spend_ledger')) {
      const day = String(r.day);
      const cost = num(r.cost_usd);
      const ex = excluded.includes(String(r.purpose));
      if (day === today && !ex) d += cost;
      if (day >= monthStart && day <= today) {
        if (ex) ml += cost;
        else m += cost;
      }
    }
    const dc = num(this.flag('daily_cap_usd'));
    const mc = num(this.flag('monthly_cap_usd'));
    const lc = num(this.flag('lesson_monthly_cap_usd'), 30);
    const paid = this.flag('paid_llm_enabled') === true;
    const deg = this.flag('degraded_mode') === true;
    const chatOk = paid && d < dc && m < mc;
    return {
      paid_allowed: isLesson ? paid && ml < lc : chatOk,
      degraded: deg,
      day_usd: d,
      month_usd: m,
      daily_cap: dc,
      monthly_cap: mc,
      state: deg ? 'degraded' : chatOk ? 'normal' : 'free_only',
      lesson_month_usd: ml,
      lesson_cap: lc,
    };
  }

  async spendLedger(fromDay: string): Promise<SpendLedgerRow[]> {
    return this.table('spend_ledger')
      .filter((r) => String(r.day) >= fromDay)
      .map((r) => ({ day: String(r.day), purpose: String(r.purpose), provider: String(r.provider), calls: num(r.calls), cost_usd: num(r.cost_usd) }));
  }

  async providerHealth(): Promise<ProviderHealthRow[]> {
    return this.table('provider_health').map((r) => clone(r) as unknown as ProviderHealthRow);
  }
  async updateProviderHealth(provider: string, patch: Partial<Omit<ProviderHealthRow, 'provider'>>): Promise<void> {
    const rows = this.table('provider_health');
    const r = rows.find((x) => x.provider === provider);
    // PostgrestDb ile aynı: PATCH (bot_runtime'da insert yetkisi yok); satır yoksa 0 satır güncellenir.
    if (r) Object.assign(r, patch, { updated_at: this.nowIso() });
  }

  // ---------------------------------------------------------------- puanlama ve ustalık
  private insertObservation(o: Row): number {
    const src = String(o.source_type);
    const sourceId = String(o.source_id);
    const eid = String(o.enrollment_id);
    const ok =
      (src === 'attempt' && this.table('attempts').some((a) => String(a.id) === sourceId && a.enrollment_id === eid)) ||
      (src === 'message' && this.table('messages').some((m) => String(m.id) === sourceId && m.student_id === this.enrollmentStudent(eid))) ||
      (src === 'observation' && this.table('observations').some((x) => String(x.id) === sourceId && x.enrollment_id === eid));
    if (!ok) throw new DbError('OGR-EVID-001', `kaynaksız gözlem ${src}:${sourceId}`);
    const cur = this.enrollmentCurriculum(eid);
    if (!this.skill(cur, String(o.skill_id))) throw new DbError('23503', `kazanım yok ${String(o.skill_id)}`);
    const id = this.nextId('observations');
    this.table('observations').push({
      id,
      curriculum_id: cur,
      value: null,
      weight: 1,
      confidence: null,
      quote: null,
      misconception_tag: null,
      guess_override: null,
      counts_for_mastery: true,
      applied_at: null,
      created_at: this.nowIso(),
      ...o,
    });
    return id;
  }

  /** `public.apply_observation` eşleniği (§3.7). */
  private applyObservation(obsId: number): void {
    const o = this.table('observations').find((x) => x.id === obsId);
    if (!o || o.applied_at) return;
    const cur = String(o.curriculum_id);
    const sk = this.skill(cur, String(o.skill_id));
    if (!sk || sk.is_leaf !== true) throw new DbError('OGR-MAST-002', `yaprak olmayan kazanım ${String(o.skill_id)}`);
    const mastery = this.table('mastery');
    let m = mastery.find((x) => x.enrollment_id === o.enrollment_id && x.skill_id === o.skill_id);
    if (!m) {
      m = { enrollment_id: o.enrollment_id, curriculum_id: cur, skill_id: o.skill_id, p: num(sk.p_init, 0.3), evidence_count: 0, last_observation_id: null, last_evidence_at: null, updated_at: this.nowIso() };
      mastery.push(m);
    }
    const kind = String(o.kind) as ObservationKind;
    const step = observationStep(
      num(m.p),
      {
        kind,
        value: o.value === null || o.value === undefined ? null : num(o.value),
        weight: o.weight === null || o.weight === undefined ? null : num(o.weight),
        confidence: o.confidence === null || o.confidence === undefined ? null : num(o.confidence),
        guess_override: o.guess_override === null || o.guess_override === undefined ? null : num(o.guess_override),
        counts_for_mastery: o.counts_for_mastery !== false,
      },
      { p_guess: num(sk.p_guess, 0.25), p_slip: num(sk.p_slip, 0.1), p_learn: num(sk.p_learn, 0.1) },
    );
    o.applied_at = this.nowIso();
    if (step.method !== null) {
      this.table('mastery_history').push({
        id: this.nextId('mastery_history'),
        enrollment_id: o.enrollment_id,
        skill_id: o.skill_id,
        observation_id: o.id,
        p_before: m.p,
        p_after: step.p,
        method: step.method,
        params: step.params,
        created_at: this.nowIso(),
      });
      Object.assign(m, {
        p: step.p,
        evidence_count: num(m.evidence_count) + step.evidenceIncrement,
        last_observation_id: o.id,
        last_evidence_at: step.evidenceIncrement > 0 ? this.nowIso() : m.last_evidence_at,
        updated_at: this.nowIso(),
      });
    }
    const tag = s(o.misconception_tag);
    if (tag !== null && (o.value === null || o.value === undefined || num(o.value) < 0.5)) {
      const t = this.table('misconception_tags').find((x) => x.tag === tag);
      if (t) {
        const skillId = s(t.skill_id) ?? String(o.skill_id);
        const mcs = this.table('misconceptions');
        const active = (r: Row): boolean => r.status === 'pending_review' || r.status === 'open';
        if (!mcs.some((r) => r.enrollment_id === o.enrollment_id && r.skill_id === skillId && r.tag === tag && active(r))) {
          mcs.push({
            id: this.uuid(),
            enrollment_id: o.enrollment_id,
            curriculum_id: cur,
            skill_id: skillId,
            tag,
            text_instructor: t.text_instructor,
            text_student: t.text_student,
            status: 'pending_review',
            evidence_count: 0,
            first_seen: this.nowIso(),
            last_seen: this.nowIso(),
            resolved_at: null,
            resolved_by: null,
            resolution_observation_id: null,
            rejected_by: null,
            reject_note: null,
          });
        }
        const openAt = num(this.setting('misconception_open_evidence'), 3);
        for (const r of mcs) {
          if (r.enrollment_id !== o.enrollment_id || r.tag !== tag || !['pending_review', 'open', 'resolved'].includes(String(r.status))) continue;
          const next = num(r.evidence_count) + 1;
          r.status = r.status === 'resolved' ? 'pending_review' : r.status === 'pending_review' && next >= openAt ? 'open' : r.status;
          r.evidence_count = next;
          r.last_seen = this.nowIso();
        }
        const ev = this.table('misconception_evidence');
        for (const r of mcs) {
          if (r.enrollment_id === o.enrollment_id && r.tag === tag && active(r) && !ev.some((e) => e.misconception_id === r.id && e.observation_id === o.id)) {
            ev.push({ misconception_id: r.id, observation_id: o.id });
          }
        }
        const prereq = s(t.prereq_skill_id);
        if (['diagnostic', 'practice', 'test'].includes(kind) && prereq !== null && prereq !== o.skill_id) {
          const inf = this.insertObservation({
            enrollment_id: o.enrollment_id,
            skill_id: prereq,
            kind: 'inferred',
            value: 0,
            weight: 0.5,
            source_type: 'observation',
            source_id: String(o.id),
            source_locator: `${String(o.source_locator)} (ön koşul çıkarımı)`,
            misconception_tag: null,
            counts_for_mastery: false,
            created_by_role: o.created_by_role,
          });
          this.applyObservation(inf);
        }
      }
    }
  }

  private inferPrereqGap(eid: string, skillId: string): string | null {
    const mastery = this.table('mastery');
    const m = mastery.find((x) => x.enrollment_id === eid && x.skill_id === skillId);
    if (!m || num(m.p) >= 0.4 || num(m.evidence_count) < 5) return null;
    const cur = String(m.curriculum_id ?? this.enrollmentCurriculum(eid));
    const cands = this.table('skill_prerequisites')
      .filter((sp) => sp.skill_id === skillId && sp.curriculum_id === cur)
      .map((sp) => ({ sp, pm: mastery.find((x) => x.enrollment_id === eid && x.skill_id === sp.prereq_id) }))
      .filter((x) => x.pm && num(x.pm.p) < 0.5 && num(x.pm.evidence_count) >= 5)
      .sort((a, b) => num(a.pm?.p) - num(b.pm?.p));
    const first = cands[0];
    if (!first) return null;
    const name = s(this.skill(cur, String(first.sp.prereq_id))?.name);
    return name === null ? null : `Asıl sorun alt konuda olabilir: ${name}`;
  }

  async gradeAttempt(
    enrollmentId: string,
    questionId: string,
    chosen: { key?: string; value?: string },
    context: 'diagnostic' | 'practice' | 'test',
    sessionId: string | null,
    responseMs: number | null,
  ): Promise<GradeResult> {
    this.rpc('grade_attempt');
    this.requireEnrollment(enrollmentId);
    const q = this.table('questions').find((x) => x.id === questionId && x.status === 'approved');
    if (!q) throw new DbError('OGR-GRADE-003', 'onaysız soru');
    const attempts = this.table('attempts');
    if (sessionId !== null && attempts.some((a) => a.session_id === sessionId && a.question_id === questionId)) throw new DbError('OGR-GRADE-002', 'zaten cevaplandı');
    const verdict = this.opts.oracle?.verdict(questionId, chosen) ?? null;
    if (verdict === null) throw new DbError('OGR-GRADE-004', 'cevap anahtarı yok');
    let tag: string | null = null;
    if (q.kind === 'mcq' && verdict === false) {
      tag = s(((q.options as Row[] | null) ?? []).find((o) => o.key === chosen.key)?.misconception_tag);
    }
    const attemptNo = Math.max(0, ...attempts.filter((a) => a.enrollment_id === enrollmentId && a.question_id === questionId).map((a) => num(a.attempt_no))) + 1;
    const attId = this.nextId('attempts');
    attempts.push({
      id: attId,
      enrollment_id: enrollmentId,
      question_id: questionId,
      context,
      session_id: sessionId,
      chosen: clone(chosen),
      attempt_no: attemptNo,
      is_correct: verdict,
      misconception_tag: tag,
      graded_at: this.nowIso(),
      response_ms: responseMs,
      created_at: this.nowIso(),
    });
    const skills = (q.skill_ids as string[]) ?? [];
    for (const sk of skills) {
      let locator = `Pratik · ${questionId.slice(0, 8)}`;
      if (context === 'diagnostic') {
        const ds = this.table('diagnostic_sessions').find((d) => d.id === sessionId);
        const test = this.table('diagnostic_tests').find((t) => t.id === ds?.test_id);
        const pos = ((test?.item_ids as string[] | undefined) ?? []).indexOf(questionId);
        locator = `Teşhis · Soru ${pos >= 0 ? pos + 1 : '?'}`;
      }
      const obs = this.insertObservation({
        enrollment_id: enrollmentId,
        skill_id: sk,
        kind: context,
        value: verdict ? 1 : 0,
        weight: 1,
        source_type: 'attempt',
        source_id: String(attId),
        source_locator: locator,
        misconception_tag: tag,
        guess_override: q.kind === 'numeric' ? 0.05 : null,
        counts_for_mastery: attemptNo === 1,
        created_by_role: 'bot_runtime',
      });
      this.applyObservation(obs);
    }
    const first = skills[0] ?? '';
    const m = this.table('mastery').find((x) => x.enrollment_id === enrollmentId && x.skill_id === first);
    const pool = this.table('content_pool').find(
      (cp) =>
        cp.status === 'approved' &&
        cp.curriculum_id === q.curriculum_id &&
        cp.skill_id === first &&
        cp.mode === 'socratic' &&
        cp.kind === (verdict ? 'feedback_right' : 'feedback_wrong') &&
        (s(cp.misconception_tag) ?? '') === (tag ?? ''),
    );
    const hint = verdict ? null : this.inferPrereqGap(enrollmentId, first);
    this.audit('RPC:grade_attempt', 'attempts', String(attId), { correct: verdict });
    return {
      is_correct: verdict,
      misconception_tag: tag,
      feedback_student: tag === null ? null : s(this.table('misconception_tags').find((t) => t.tag === tag)?.text_student),
      feedback_pool_id: s(pool?.id),
      mastery_p: m ? num(m.p) : null,
      evidence_count: m ? num(m.evidence_count) : null,
      is_reliable: m ? num(m.evidence_count) >= this.minEvidence() : false,
      prereq_hint: hint,
    };
  }

  async revealSolution(enrollmentId: string, questionId: string): Promise<string | null> {
    this.rpc('reveal_solution');
    const sid = this.requireEnrollment(enrollmentId);
    if (!this.table('attempts').some((a) => a.enrollment_id === enrollmentId && a.question_id === questionId)) return null;
    const sol = this.opts.oracle?.solution(questionId) ?? null;
    this.audit('RPC:reveal_solution', 'questions', questionId, { student: sid });
    return sol;
  }

  async diagnosticStatus(enrollmentId: string): Promise<'none' | 'in_progress' | 'finished'> {
    this.requireEnrollment(enrollmentId);
    const rows = this.table('diagnostic_sessions').filter((d) => d.enrollment_id === enrollmentId);
    if (rows.some((d) => d.status === 'finished')) return 'finished';
    const dayAgo = this.now().getTime() - 86_400_000;
    if (rows.some((d) => d.status === 'in_progress' && Date.parse(String(d.started_at)) > dayAgo)) return 'in_progress';
    return 'none';
  }

  async startDiagnostic(enrollmentId: string, chatId: number): Promise<string> {
    this.rpc('start_diagnostic');
    this.requireEnrollment(enrollmentId);
    const dayAgo = this.now().getTime() - 86_400_000;
    const existing = this.table('diagnostic_sessions').find((d) => d.enrollment_id === enrollmentId && d.status === 'in_progress' && Date.parse(String(d.started_at)) > dayAgo);
    if (existing) return String(existing.id);
    const cur = this.enrollmentCurriculum(enrollmentId);
    const test = this.table('diagnostic_tests')
      .filter((t) => t.curriculum_id === cur)
      .sort((a, b) => String(b.version).localeCompare(String(a.version)))[0];
    if (!test) throw new DbError('23502', 'teşhis testi yok');
    const id = this.uuid();
    this.table('diagnostic_sessions').push({ id, enrollment_id: enrollmentId, test_id: test.id, chat_id: chatId, current_index: 0, status: 'in_progress', started_at: this.nowIso(), finished_at: null, result: null });
    return id;
  }

  private ownSession(sessionId: string): Row | undefined {
    const ds = this.table('diagnostic_sessions').find((d) => d.id === sessionId);
    if (!ds || this.student === null || this.enrollmentStudent(String(ds.enrollment_id)) !== this.student) return undefined;
    return ds;
  }

  async nextDiagnosticItem(sessionId: string): Promise<DiagnosticItem | null> {
    this.rpc('next_diagnostic_item');
    this.requireStudent();
    const ds = this.ownSession(sessionId);
    if (!ds || ds.status !== 'in_progress') return null;
    const test = this.table('diagnostic_tests').find((t) => t.id === ds.test_id);
    const items = (test?.item_ids as string[] | undefined) ?? [];
    const idx = num(ds.current_index);
    const qid = items[idx];
    if (qid === undefined) return null;
    const q = this.table('questions').find((x) => x.id === qid);
    if (!q) return null;
    const f = q.figure_id ? this.table('figures').find((x) => x.id === q.figure_id) : undefined;
    return {
      question_id: qid,
      stem: String(q.stem),
      figure_png: s(f?.png_path),
      alt_text: s(f?.alt_text),
      options: this.stripTags(q.options),
      idx: idx + 1,
      total: items.length,
    };
  }

  async advanceDiagnostic(sessionId: string): Promise<number> {
    this.rpc('advance_diagnostic');
    this.requireStudent();
    const ds = this.ownSession(sessionId);
    if (!ds) throw new DbError('OGR-AUTH-004', 'başka öğrenci', 403);
    ds.current_index = num(ds.current_index) + 1;
    return num(ds.current_index);
  }

  async finishDiagnostic(sessionId: string): Promise<DiagnosticResult> {
    this.rpc('finish_diagnostic');
    this.requireStudent();
    const ds = this.ownSession(sessionId);
    if (!ds) throw new DbError('OGR-AUTH-004', 'başka öğrenci', 403);
    const eid = String(ds.enrollment_id);
    const minEv = this.minEvidence();
    const rows = this.table('mastery')
      .filter((m) => m.enrollment_id === eid)
      .map((m) => ({ m, sk: this.skill(String(m.curriculum_id), String(m.skill_id)) }))
      .sort((a, b) => num(a.m.p) - num(b.m.p));
    const res: DiagnosticResult = {
      per_skill: rows.length === 0 ? null : rows.map(({ m, sk }) => ({ skill_id: String(m.skill_id), name: String(sk?.name ?? m.skill_id), p: num(m.p), n: num(m.evidence_count), reliable: num(m.evidence_count) >= minEv })),
      weakest: rows.length === 0 ? null : rows.slice(0, 3).map(({ m, sk }) => String(sk?.name ?? m.skill_id)),
      open_tags: this.table('misconceptions')
        .filter((mc) => mc.enrollment_id === eid && (mc.status === 'pending_review' || mc.status === 'open'))
        .map((mc) => String(mc.tag)),
    };
    Object.assign(ds, { status: 'finished', finished_at: this.nowIso(), result: res });
    return clone(res);
  }

  async nextPracticeItems(enrollmentId: string, n: number): Promise<PracticeItem[]> {
    this.rpc('next_practice_items');
    this.requireEnrollment(enrollmentId);
    const cur = this.enrollmentCurriculum(enrollmentId);
    const minEv = this.minEvidence();
    const mastery = this.table('mastery');
    const mcs = this.table('misconceptions');
    const ranked = this.table('skills')
      .filter((k) => k.curriculum_id === cur && k.is_leaf === true)
      .map((k) => {
        const m = mastery.find((x) => x.enrollment_id === enrollmentId && x.skill_id === k.id);
        const ev = m ? num(m.evidence_count) : 0;
        const cls = m && ev >= minEv ? 0 : m && ev > 0 ? 1 : 2;
        const mis = mcs.some((mc) => mc.enrollment_id === enrollmentId && mc.skill_id === k.id && (mc.status === 'pending_review' || mc.status === 'open')) ? 0 : 1;
        return { sid: String(k.id), cls, mis, p: m ? num(m.p) : Number.POSITIVE_INFINITY, order: num(k.order_no) };
      })
      .sort((a, b) => a.cls - b.cls || a.mis - b.mis || a.p - b.p || a.order - b.order)
      .map((r, i) => ({ ...r, rn: i + 1 }));
    const rnOf = new Map(ranked.map((r) => [r.sid, r.rn]));
    const seen = new Set(this.table('attempts').filter((a) => a.enrollment_id === enrollmentId).map((a) => a.question_id));
    const cands = this.table('questions')
      .filter((q) => {
        const first = ((q.skill_ids as string[]) ?? [])[0] ?? '';
        if (q.curriculum_id !== cur || q.status !== 'approved' || !rnOf.has(first)) return false;
        if (q.source !== 'template' && q.source !== 'instructor') return false;
        if (seen.has(q.id)) return false;
        if (q.figure_id) {
          const f = this.table('figures').find((x) => x.id === q.figure_id);
          if (!f || f.review_status !== 'verified') return false;
        }
        return true;
      })
      .map((q) => ({ q, skill: ((q.skill_ids as string[]) ?? [])[0] ?? '', r: this.opts.random() }));
    const perSkill = new Map<string, Array<(typeof cands)[number]>>();
    for (const c of cands) perSkill.set(c.skill, [...(perSkill.get(c.skill) ?? []), c]);
    const flat: Array<{ c: (typeof cands)[number]; per: number; rn: number }> = [];
    for (const [skill, list] of perSkill) {
      list.sort((a, b) => a.r - b.r);
      list.forEach((c, i) => flat.push({ c, per: i + 1, rn: rnOf.get(skill) ?? 999 }));
    }
    flat.sort((a, b) => a.per - b.per || a.rn - b.rn);
    return flat.slice(0, Math.max(1, n)).map(({ c }) => {
      const f = c.q.figure_id ? this.table('figures').find((x) => x.id === c.q.figure_id) : undefined;
      return {
        question_id: String(c.q.id),
        stem: String(c.q.stem),
        figure_png: s(f?.png_path),
        alt_text: s(f?.alt_text),
        options: c.q.kind === 'mcq' ? this.stripTags(c.q.options) : null,
        skill_id: c.skill,
        kind: c.q.kind as 'mcq' | 'numeric',
      };
    });
  }

  async questionPublic(questionId: string): Promise<QuestionPublic | null> {
    const q = this.table('questions').find((x) => x.id === questionId && x.status === 'approved');
    if (!q) return null;
    return {
      id: String(q.id),
      curriculum_id: String(q.curriculum_id),
      skill_ids: [...((q.skill_ids as string[]) ?? [])],
      kind: q.kind as 'mcq' | 'numeric',
      stem: String(q.stem),
      figure_id: s(q.figure_id),
      options: q.kind === 'mcq' ? this.stripTags(q.options) : null,
    };
  }

  async sessionAttempts(sessionId: string): Promise<SessionAttemptStats> {
    const sid = this.requireStudent();
    const rows = this.table('attempts').filter((a) => a.session_id === sessionId && this.enrollmentStudent(String(a.enrollment_id)) === sid);
    return { total: rows.length, correct: rows.filter((a) => a.is_correct === true).length, attempted_question_ids: rows.map((a) => String(a.question_id)) };
  }

  async masteryView(enrollmentId: string): Promise<MasteryViewRow[]> {
    this.requireEnrollment(enrollmentId);
    const minEv = this.minEvidence();
    return this.table('mastery')
      .filter((m) => m.enrollment_id === enrollmentId)
      .map((m) => {
        const p = num(m.p);
        return {
          skill_id: String(m.skill_id),
          skill_name: String(this.skill(String(m.curriculum_id), String(m.skill_id))?.name ?? m.skill_id),
          p,
          evidence_count: num(m.evidence_count),
          is_reliable: num(m.evidence_count) >= minEv,
          band: p < 0.4 ? 'düşük' : p < 0.7 ? 'orta' : 'yüksek',
        };
      });
  }

  // ---------------------------------------------------------------- hafıza, profil, havuz
  async retrieveMemory(embedding: number[] | null, text: string, k: number): Promise<MemoryHit[]> {
    this.rpc('retrieve_memory');
    const sid = this.requireStudent();
    const today = this.today();
    const q = stems(text);
    const cos = (a: number[], b: number[]): number => {
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        dot += (a[i] ?? 0) * (b[i] ?? 0);
        na += (a[i] ?? 0) ** 2;
        nb += (b[i] ?? 0) ** 2;
      }
      return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
    };
    return this.table('memory_facts')
      .filter((f) => f.student_id === sid && f.status === 'active' && (f.valid_until === null || f.valid_until === undefined || String(f.valid_until) >= today))
      .filter((f) => f.requires_approval !== true || f.approved === true)
      .map((f) => {
        const emb = Array.isArray(f.embedding) ? (f.embedding as number[]) : null;
        const vec = embedding === null || emb === null ? 0 : 0.7 * cos(emb, embedding);
        const fs = stems(String(f.text));
        let overlap = 0;
        for (const w of q) if (fs.has(w)) overlap++;
        const fts = text.trim() === '' || q.size === 0 ? 0 : 0.3 * (overlap / q.size);
        return { f, score: vec + fts };
      })
      .sort((a, b) => b.score - a.score || String(b.f.created_at).localeCompare(String(a.f.created_at)))
      .slice(0, Math.max(1, k))
      .map(({ f, score }) => ({ fact_id: num(f.id), kind: String(f.kind), text: String(f.text), valid_until: s(f.valid_until), approved: f.approved === true, score }));
  }

  async profileForPrompt(enrollmentId: string): Promise<PromptProfile> {
    this.rpc('profile_for_prompt');
    const sid = this.requireEnrollment(enrollmentId);
    const view = (await this.masteryView(enrollmentId)).filter((r) => r.is_reliable).sort((a, b) => a.p - b.p);
    const weakest = view[0]?.skill_id ?? null;
    const summary = this.table('weekly_summaries')
      .filter((w) => w.student_id === sid)
      .sort((a, b) => String(b.week_start).localeCompare(String(a.week_start)))[0];
    const body = s(summary?.body);
    const sentences = body === null ? [] : body.split(/(?<=\.)\s+/).filter((x) => x.trim() !== '');
    return {
      weak: view.slice(0, 3).map((r) => ({ skill_id: r.skill_id, name: r.skill_name, band: r.band })),
      misconceptions: this.table('misconceptions')
        .filter((mc) => mc.enrollment_id === enrollmentId && mc.status === 'open')
        .map((mc) => String(mc.text_student)),
      prereq_hint: weakest === null ? null : this.inferPrereqGap(enrollmentId, weakest),
      explanation_notes: s(this.table('preferences').find((p) => p.student_id === sid)?.explanation_notes),
      weekly_line: sentences.length === 0 ? null : (sentences[sentences.length - 1] ?? null),
    };
  }

  async approvedFacts(enrollmentId: string): Promise<ApprovedFact[]> {
    const sid = this.requireEnrollment(enrollmentId);
    const facts: ApprovedFact[] = this.table('memory_facts')
      .filter((f) => f.student_id === sid && f.kind === 'instructor_fact' && f.approved === true && f.status === 'active')
      .map((f) => ({ source: 'memory_fact', id: String(f.id), text: String(f.text) }));
    for (const n of this.table('instructor_notes')) {
      if (n.enrollment_id === enrollmentId && n.approved_fact === true) facts.push({ source: 'instructor_note', id: String(n.id), text: String(n.body) });
    }
    return facts;
  }

  async lastObservationContext(enrollmentId: string): Promise<ObservationContext | null> {
    this.requireEnrollment(enrollmentId);
    const o = this.table('observations')
      .filter((x) => x.enrollment_id === enrollmentId && x.kind !== 'inferred')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || num(b.id) - num(a.id))[0];
    return o ? { skill_id: String(o.skill_id), misconception_tag: s(o.misconception_tag) } : null;
  }

  async findPool(q: { curriculum_id: string; kind: string; skill_id: string; misconception_tag: string | null; mode: 'socratic' | 'direct' }): Promise<PoolRow | null> {
    const r = this.table('content_pool').find(
      (cp) =>
        cp.status === 'approved' &&
        cp.curriculum_id === q.curriculum_id &&
        cp.kind === q.kind &&
        cp.skill_id === q.skill_id &&
        (s(cp.misconception_tag) ?? '') === (q.misconception_tag ?? '') &&
        cp.mode === q.mode,
    );
    return r ? { id: String(r.id), kind: String(r.kind), skill_id: String(r.skill_id), misconception_tag: s(r.misconception_tag), mode: r.mode as 'socratic', body: String(r.body) } : null;
  }

  async poolById(poolId: string): Promise<PoolRow | null> {
    const r = this.table('content_pool').find((cp) => cp.id === poolId && cp.status === 'approved');
    return r ? { id: String(r.id), kind: String(r.kind), skill_id: String(r.skill_id), misconception_tag: s(r.misconception_tag), mode: r.mode as 'socratic', body: String(r.body) } : null;
  }

  async poolHit(poolId: string): Promise<void> {
    this.rpc('pool_hit');
    const r = this.table('content_pool').find((cp) => cp.id === poolId);
    if (r) r.hit_count = num(r.hit_count) + 1;
  }

  async insertPoolCandidate(row: PoolCandidate): Promise<void> {
    const rows = this.table('content_pool');
    const dup = rows.some(
      (cp) =>
        cp.status !== 'rejected' &&
        cp.curriculum_id === row.curriculum_id &&
        cp.kind === row.kind &&
        cp.skill_id === row.skill_id &&
        (s(cp.misconception_tag) ?? '') === (row.misconception_tag ?? '') &&
        cp.mode === row.mode,
    );
    if (dup) return;
    rows.push({ id: this.uuid(), ...row, status: 'pending_review', hit_count: 0, approved_by: null, approved_at: null, created_at: this.nowIso() });
  }

  async recordChatObservation(enrollmentId: string, skillId: string, kind: 'chat_question' | 'chat_misconception', messageId: number, quote: string, tag: string | null): Promise<number> {
    this.rpc('record_chat_observation');
    this.requireEnrollment(enrollmentId);
    if (kind !== 'chat_question' && kind !== 'chat_misconception') throw new DbError('OGR-OBS-001', 'tür');
    const obs = this.insertObservation({
      enrollment_id: enrollmentId,
      skill_id: skillId,
      kind,
      value: null,
      source_type: 'message',
      source_id: String(messageId),
      source_locator: `Sohbet · ${istanbulDay(this.now())} ${String(istanbulHour(this.now())).padStart(2, '0')}:${String(this.now().getUTCMinutes()).padStart(2, '0')}`,
      quote: Array.from(quote).slice(0, 240).join(''),
      misconception_tag: tag,
      counts_for_mastery: false,
      created_by_role: 'bot_runtime',
    });
    this.applyObservation(obs);
    return obs;
  }

  // ---------------------------------------------------------------- günlük
  /**
   * `log_bot_response(p)` argümanlarının kopyası (test denetimi). `guards` gibi sözleşmede olup
   * `bot_responses` tablosunda sütunu olmayan alanlar yalnız burada görünür (README not 13).
   */
  get botResponsePayloads(): ReadonlyArray<Record<string, unknown>> {
    return this.shared.payloads;
  }

  async logBotResponse(p: Record<string, unknown>): Promise<number> {
    this.rpc('log_bot_response');
    this.shared.payloads.push(clone(p));
    if (typeof p.purpose !== 'string' || typeof p.response_text !== 'string') throw new DbError('OGR-LOG-001', 'şema');
    const id = this.nextId('bot_responses');
    const st = this.student === null ? undefined : this.table('students').find((x) => x.id === this.student);
    const row: Row = {
      id,
      in_message_id: p.in_message_id ?? null,
      chat_id: p.chat_id,
      student_id: this.student,
      out_telegram_message_id: null,
      purpose: p.purpose,
      mode: p.mode ?? null,
      prompt_version: p.prompt_version ?? null,
      prompt_hash: p.prompt_hash ?? null,
      prompt_text: p.prompt_text ?? null,
      response_text: p.response_text,
      memory_fact_ids: p.memory_fact_ids ?? [],
      recent_message_ids: p.recent_message_ids ?? [],
      pool_id: p.pool_id ?? null,
      cache_hit: p.cache_hit === true,
      provider: p.provider ?? null,
      model: p.model ?? null,
      provider_attempts: p.provider_attempts ?? [],
      tokens_in: p.tokens_in ?? null,
      tokens_out: p.tokens_out ?? null,
      cost_usd: num(p.cost_usd),
      latency_ms: p.latency_ms ?? null,
      confidence: p.confidence ?? null,
      escalated: p.escalated === true,
      schema_valid: p.schema_valid ?? null,
      quota_state: p.quota_state ?? null,
      degraded_mode: p.degraded_mode === true,
      pii_replacements: num(p.pii_replacements),
      flagged: false,
      created_at: this.nowIso(),
    };
    this.table('bot_responses').push(row);
    for (const a of (p.provider_attempts as Row[] | undefined) ?? []) {
      const call: Row = {
        id: this.nextId('llm_calls'),
        purpose: 'chat',
        provider: a.provider,
        model: a.model,
        tokens_in: num(a.tokens_in),
        tokens_out: num(a.tokens_out),
        batch: false,
        status: a.status,
        error_code: a.error_code ?? null,
        latency_ms: a.latency_ms ?? null,
        cost_usd: num(a.cost_usd),
        ref_table: 'bot_responses',
        ref_id: String(id),
        student_ref: s(st?.public_ref),
        created_at: this.nowIso(),
      };
      this.table('llm_calls').push(call);
      this.spendRollup(call);
    }
    return id;
  }

  async setOutMessage(responseId: number, telegramMessageId: number): Promise<void> {
    this.rpc('set_out_message');
    const r = this.table('bot_responses').find((x) => x.id === responseId && (x.student_id === this.student || x.student_id === null));
    if (r) r.out_telegram_message_id = telegramMessageId;
  }

  // ---------------------------------------------------------------- gruplar, yükseltme, alarm
  async openEscalation(chatId: number, messageId: number | null, reason: EscalationReason, questionText: string | null): Promise<string> {
    this.rpc('open_escalation');
    const staff = await this.chatStaff(chatId);
    const target =
      staff.find((x) => x.role === 'instructor' && (x.subject === null || x.subject === 'matematik')) ??
      staff.find((x) => x.role === 'instructor') ??
      staff.find((x) => x.role === 'coordinator');
    const coord = this.table('staff').find((x) => x.role === 'coordinator' && x.active === true);
    const id = this.uuid();
    this.table('escalations').push({
      id,
      chat_id: chatId,
      message_id: messageId,
      student_id: this.student,
      reason,
      question_text: questionText,
      target_staff_id: target?.staff_id ?? coord?.id ?? null,
      status: 'open',
      created_at: this.nowIso(),
      answered_at: null,
      answered_by: null,
    });
    return id;
  }

  async markAnswered(chatId: number, replyToTelegramMessageId: number, staffTg: number): Promise<void> {
    this.rpc('mark_answered');
    const cr = this.table('chat_roles').find((c) => c.chat_id === chatId && c.telegram_user_id === staffTg);
    const staffId = s(cr?.staff_id);
    if (staffId === null) return;
    const msg = this.table('messages').find((m) => m.chat_id === chatId && m.telegram_message_id === replyToTelegramMessageId);
    if (!msg) return;
    const at = this.nowIso();
    if (msg.answered_at === null || msg.answered_at === undefined) msg.answered_at = at;
    const escIds: string[] = [];
    for (const e of this.table('escalations')) {
      if (e.message_id === msg.id && e.status === 'open') {
        Object.assign(e, { status: 'answered', answered_at: at, answered_by: staffId });
        escIds.push(String(e.id));
      }
    }
    for (const a of this.table('instructor_alerts')) {
      const ref = (a.ref ?? {}) as Row;
      if (a.status === 'open' && (ref.message_id === msg.id || escIds.includes(String(ref.escalation_id)))) Object.assign(a, { status: 'done', resolved_at: at, resolved_by: staffId });
    }
  }

  private alertKey(kind: string, studentId: string | null, ref: Row, detail: string): string {
    const refKey = ['message_id', 'fact_id', 'escalation_id', 'chat_id', 'lesson_id', 'source_id'].map((k) => ref[k]).find((v) => v !== undefined && v !== null);
    return [kind, studentId ?? '', refKey === undefined ? '' : String(refKey), Array.from(detail).slice(0, 24).join('')].join('|');
  }

  private insertAlert(kind: string, severity: string, studentId: string | null, staffId: string | null, detail: string, since: string, ref: Row): boolean {
    const rows = this.table('instructor_alerts');
    const key = this.alertKey(kind, studentId, ref, detail);
    if (rows.some((a) => a.status === 'open' && this.alertKey(String(a.kind), s(a.student_id), (a.ref ?? {}) as Row, String(a.detail)) === key)) return false;
    rows.push({ id: this.uuid(), kind, severity, student_id: studentId, staff_id: staffId, detail: Array.from(detail).slice(0, 240).join(''), since, ref: clone(ref), status: 'open', created_at: this.nowIso(), resolved_at: null, resolved_by: null });
    return true;
  }

  async openOpsAlert(alert: OpsAlertInput): Promise<void> {
    this.insertAlert('ops', alert.severity, alert.student_id ?? null, null, alert.detail, this.nowIso(), alert.ref);
  }

  async closeOpsAlert(detail: string, ref: Record<string, unknown>): Promise<void> {
    const key = this.alertKey('ops', null, ref, detail);
    for (const a of this.table('instructor_alerts')) {
      if (a.status === 'open' && this.alertKey(String(a.kind), s(a.student_id), (a.ref ?? {}) as Row, String(a.detail)) === key) {
        Object.assign(a, { status: 'done', resolved_at: this.nowIso() });
      }
    }
  }

  // ---------------------------------------------------------------- proaktif, araştırma, öncelik
  async dueProactive(nowIso: string): Promise<ProactiveRow[]> {
    this.rpc('cron_due_proactive');
    const now = new Date(nowIso);
    const today = istanbulDay(now);
    const tomorrow = addDays(today, 1);
    const rows = this.table('proactive_messages');
    const silentDays = num(this.setting('alert_silent_days'), 3);
    const dayOf = (r: Row): string => istanbulDay(new Date(String(r.scheduled_for)));
    const enqueue = (studentId: string, template: string, params: Row): void => {
      if (rows.some((r) => r.student_id === studentId && r.recipient === 'student' && dayOf(r) === today)) return;
      const chat = this.table('chat_roles').find(
        (c) => c.student_id === studentId && this.table('tg_chats').some((t) => t.chat_id === c.chat_id && t.kind === 'private'),
      );
      rows.push({ id: this.uuid(), student_id: studentId, chat_id: chat?.chat_id ?? null, recipient: 'student', template_id: template, params, scheduled_for: nowIso, sent_at: null, telegram_message_id: null, status: 'scheduled' });
    };
    for (const st of this.table('students')) {
      if (st.status !== 'active') continue;
      const sid = String(st.id);
      const facts = this.table('memory_facts').filter((f) => f.student_id === sid && f.kind === 'deadline' && f.status === 'active' && typeof f.valid_until === 'string');
      const exam = facts.find((f) => f.valid_until === tomorrow && /sınav|deneme/i.test(String(f.text)));
      const soon = facts.find((f) => String(f.valid_until) >= today && String(f.valid_until) <= addDays(today, 2));
      const last = this.table('messages')
        .filter((m) => m.student_id === sid && m.sender_role === 'student')
        .map((m) => Date.parse(String(m.sent_at)))
        .sort((a, b) => b - a)[0];
      if (exam) enqueue(sid, 'exam_tomorrow', { fact_id: exam.id });
      else if (soon) enqueue(sid, 'deadline_soon', { fact_id: soon.id });
      else if (last !== undefined && now.getTime() - last > silentDays * 86_400_000) enqueue(sid, 'silent_3d', {});
    }
    const hour = istanbulHour(now);
    const globalOn = this.flag('proactive_enabled') !== false;
    const out: ProactiveRow[] = [];
    for (const r of rows) {
      if (r.status !== 'scheduled' || Date.parse(String(r.scheduled_for)) > now.getTime()) continue;
      const pref = this.table('preferences').find((p) => p.student_id === r.student_id);
      if (!globalOn || pref?.proactive_enabled === false) continue;
      if (!((pref?.active_hours as number[] | undefined) ?? [18, 19, 20, 21]).includes(hour)) continue;
      if (rows.some((x) => x !== r && x.student_id === r.student_id && x.recipient === r.recipient && x.status === 'sent' && istanbulDay(new Date(String(x.sent_at))) === today)) continue;
      let chatId = r.chat_id === null || r.chat_id === undefined ? null : num(r.chat_id);
      if (r.recipient === 'guardian') {
        const gc = this.table('secure.guardian_codes')
          .filter((g) => g.student_id === r.student_id && g.used_by_telegram_user_id !== null && g.used_by_telegram_user_id !== undefined)
          .sort((a, b) => String(b.used_at).localeCompare(String(a.used_at)))[0];
        chatId = gc ? num(gc.used_by_telegram_user_id) : null;
        if (chatId === null) {
          r.status = 'skipped';
          continue;
        }
      }
      if (chatId === null) continue;
      out.push({ id: String(r.id), student_id: String(r.student_id), recipient: r.recipient as 'student' | 'guardian', chat_id: chatId, template_id: String(r.template_id), params: clone((r.params ?? {}) as Row) });
    }
    return out;
  }

  async markProactive(id: string, status: 'sent' | 'skipped' | 'failed', telegramMessageId: number | null, at: string): Promise<void> {
    const r = this.table('proactive_messages').find((x) => x.id === id);
    if (r) Object.assign(r, { status, telegram_message_id: telegramMessageId, sent_at: status === 'sent' ? at : r.sent_at });
  }

  async enqueueResearch(query: string): Promise<string> {
    this.rpc('enqueue_research');
    const sid = this.requireStudent();
    if (this.flag('research_enabled') !== true) throw new DbError('OGR-RES-001', 'araştırma kapalı');
    const q = await this.consumeQuota('research').catch(() => null);
    if (q === null || !q.allowed) throw new DbError('OGR-RES-001', 'araştırma kotası yok');
    const id = this.uuid();
    this.table('research_requests').push({ id, student_id: sid, staff_id: null, query, expanded_queries: [], status: 'queued', cost_usd: 0, created_at: this.nowIso(), finished_at: null });
    return id;
  }

  async researchRelease(outputId: string): Promise<ResearchRelease | null> {
    const o = this.table('research_outputs').find((x) => x.id === outputId && x.status === 'released');
    if (!o) return null;
    const output = (o.output ?? {}) as { synthesis?: Array<{ text: string; cites: number[] }> };
    return {
      output_id: outputId,
      synthesis: clone(output.synthesis ?? []),
      citations: this.table('citations')
        .filter((c) => c.output_id === outputId && c.status === 'kept')
        .sort((a, b) => num(a.ordinal) - num(b.ordinal))
        .map((c) => ({
          ordinal: num(c.ordinal),
          doi: s(c.doi),
          title: String(c.title),
          authors: s(c.authors),
          venue: s(c.venue),
          year: c.year === null || c.year === undefined ? null : num(c.year),
          crossref_status: String(c.crossref_status),
          oa_pdf_url: s(c.oa_pdf_url),
          status: String(c.status),
        })),
    };
  }

  async priorityPlanForEnrollment(enrollmentId: string): Promise<PriorityPlan | null> {
    this.rpc('priority_plan_for_enrollment');
    this.requireEnrollment(enrollmentId);
    const cur = this.enrollmentCurriculum(enrollmentId);
    const courses = this.table('courses').filter((c) => c.curriculum_id === cur);
    const plan = this.table('exam_priority_plans')
      .filter((p) => p.status === 'approved' && courses.some((c) => c.id === p.course_id))
      .sort((a, b) => String(b.approved_at).localeCompare(String(a.approved_at)))[0];
    if (!plan) return null;
    const course = courses.find((c) => c.id === plan.course_id);
    const body = (plan.plan ?? {}) as { years_total?: number; rows?: PriorityPlanRow[] };
    return {
      course_code: String(course?.code ?? ''),
      period: String(plan.period),
      years_total: num(body.years_total),
      rows: clone(body.rows ?? [])
        .filter((r) => num(r.rank) <= 5)
        .sort((a, b) => num(a.rank) - num(b.rank)),
    };
  }

  // ---------------------------------------------------------------- cron
  async cronOpenAlerts(): Promise<number> {
    this.rpc('cron_open_alerts');
    const now = this.now().getTime();
    const hours = num(this.setting('alert_unanswered_hours'), 6);
    const dangerHours = num(this.setting('alert_unanswered_danger_hours'), 24);
    const silentDays = num(this.setting('alert_silent_days'), 3);
    const silentDanger = num(this.setting('alert_silent_danger_days'), 7);
    const deadlineDays = num(this.setting('alert_deadline_days'), 2);
    const targetFor = (studentId: string | null): string | null => {
      const ss = this.table('staff_students').find((x) => x.student_id === studentId && this.table('staff').some((st) => st.id === x.staff_id && st.role === 'instructor'));
      return s(ss?.staff_id);
    };
    let n = 0;
    for (const e of this.table('escalations')) {
      if (e.status !== 'open') continue;
      const age = (now - Date.parse(String(e.created_at))) / 3_600_000;
      if (age < hours) continue;
      const q = s(e.question_text);
      const detail = q === null ? 'Hocaya iletilen soru cevap bekliyor' : `Hocaya iletilen soru cevap bekliyor: "${q}"`;
      if (this.insertAlert('unanswered', age >= dangerHours ? 'danger' : 'warning', s(e.student_id), s(e.target_staff_id), detail, String(e.created_at), { escalation_id: e.id })) n++;
    }
    for (const m of this.table('messages')) {
      if (m.is_question !== true || (m.answered_at !== null && m.answered_at !== undefined) || m.sender_role !== 'student') continue;
      const age = (now - Date.parse(String(m.sent_at))) / 3_600_000;
      if (age < hours) continue;
      const q = s(m.text_llm);
      const detail = q === null ? 'Cevapsız soru' : `Cevapsız soru: "${q}"`;
      if (this.insertAlert('unanswered', age >= dangerHours ? 'danger' : 'warning', s(m.student_id), targetFor(s(m.student_id)), detail, String(m.sent_at), { message_id: m.id })) n++;
    }
    for (const st of this.table('students')) {
      if (st.status === 'deleted') continue;
      const last = this.table('messages')
        .filter((m) => m.student_id === st.id && m.sender_role === 'student')
        .map((m) => Date.parse(String(m.sent_at)))
        .sort((a, b) => b - a)[0];
      if (last === undefined) continue;
      const days = Math.floor((now - last) / 86_400_000);
      if (days >= silentDays && this.insertAlert('silent', days >= silentDanger ? 'danger' : 'warning', String(st.id), targetFor(String(st.id)), `Öğrenci ${days} gündür yazmadı.`, new Date(last).toISOString(), {})) n++;
    }
    const today = this.today();
    for (const f of this.table('memory_facts')) {
      if (f.kind !== 'deadline' || f.status !== 'active' || typeof f.valid_until !== 'string') continue;
      if (f.valid_until < today || f.valid_until > addDays(today, deadlineDays)) continue;
      if (this.insertAlert('deadline', 'neutral', s(f.student_id), targetFor(s(f.student_id)), String(f.text), this.nowIso(), { fact_id: f.id })) n++;
    }
    const weekAgo = now - 7 * 86_400_000;
    const morale = new Map<string, number[]>();
    for (const f of this.table('memory_facts')) {
      if (typeof f.morale_signal !== 'number' || Date.parse(String(f.created_at)) < weekAgo) continue;
      morale.set(String(f.student_id), [...(morale.get(String(f.student_id)) ?? []), f.morale_signal]);
    }
    for (const [sid, sig] of morale) {
      const avg = sig.reduce((a, b) => a + b, 0) / sig.length;
      if (sig.length >= 3 && avg <= -1 && this.insertAlert('morale', 'warning', sid, targetFor(sid), 'Moral göstergesi düştü.', this.nowIso(), {})) n++;
    }
    for (const c of this.table('tg_chats')) {
      if (c.kind !== 'private' && c.bot_is_admin === false && this.insertAlert('ops', 'warning', null, null, 'Bot grupta yönetici değil; kayıt bildirimi sabitlenemedi', this.nowIso(), { chat_id: c.chat_id })) n++;
    }
    return n;
  }

  async cronIdleSessions(): Promise<number> {
    this.rpc('cron_idle_sessions');
    const limit = this.now().getTime() - num(this.setting('session_idle_hours'), 6) * 3_600_000;
    let n = 0;
    for (const r of this.table('sessions')) {
      if (Date.parse(String(r.last_activity_at)) >= limit) continue;
      if (!['diagnostic', 'awaiting_answer', 'test'].includes(String(r.state)) && r.direct_once !== true && num(r.hint_level) === 0) continue;
      Object.assign(r, { state: ['diagnostic', 'awaiting_answer', 'test'].includes(String(r.state)) ? 'idle' : r.state, direct_once: false, hint_level: 0 });
      n++;
    }
    return n;
  }

  async cronGroupAutoAnswer(): Promise<AutoAnswerRow[]> {
    this.rpc('cron_group_auto_answer');
    const now = this.now().getTime();
    const out: AutoAnswerRow[] = [];
    const msgs = this.table('messages');
    for (const c of this.table('tg_chats')) {
      const mins = num(c.group_auto_answer_min);
      if (mins <= 0 || c.kind === 'private') continue;
      for (const m of msgs) {
        if (m.chat_id !== c.chat_id || m.sender_role !== 'student' || m.is_question !== true || (m.answered_at !== null && m.answered_at !== undefined)) continue;
        if (typeof m.student_id !== 'string' || Date.parse(String(m.sent_at)) >= now - mins * 60_000) continue;
        const staffReplied = msgs.some(
          (x) => x.chat_id === c.chat_id && x.reply_to_telegram_message_id === m.telegram_message_id && (x.sender_role === 'instructor' || x.sender_role === 'coordinator'),
        );
        if (staffReplied || this.table('bot_responses').some((b) => b.in_message_id === m.id)) continue;
        out.push({ chat_id: num(c.chat_id), message_id: num(m.id), student_id: m.student_id, telegram_message_id: num(m.telegram_message_id) });
      }
    }
    return out;
  }

  async runRetention(): Promise<number> {
    this.rpc('run_retention');
    const now = this.now().getTime();
    let total = 0;
    for (const p of this.table('retention_policies')) {
      if (p.enabled === false || p.mode === 'custom') continue;
      const table = p.schema_name === 'public' || p.schema_name === undefined ? String(p.table_name) : `${String(p.schema_name)}.${String(p.table_name)}`;
      const rows = this.shared.t[table];
      if (!rows) continue;
      const limit = now - num(p.days) * 86_400_000;
      const cond = String(p.condition_sql ?? '').trim();
      const matches = (r: Row): boolean => {
        const v = r[String(p.ts_column)];
        if (v === null || v === undefined || Date.parse(String(v)) >= limit) return false;
        if (cond === '') return true;
        return cond.split(/\s+and\s+/i).every((c) => {
          const isNull = /^(\w+) is null$/i.exec(c);
          if (isNull) return r[isNull[1] ?? ''] === null || r[isNull[1] ?? ''] === undefined;
          const eq = /^(\w+)\s*=\s*('?)([\w-]+)\2$/.exec(c);
          if (!eq) return false;
          const want = eq[2] === "'" ? eq[3] : eq[3] === 'true' ? true : eq[3] === 'false' ? false : Number(eq[3]);
          return r[eq[1] ?? ''] === want;
        });
      };
      let affected = 0;
      if (p.mode === 'delete') {
        const keep = rows.filter((r) => !matches(r));
        affected = rows.length - keep.length;
        this.shared.t[table] = keep;
      } else {
        for (const r of rows) {
          if (!matches(r)) continue;
          if (p.mode === 'null_columns') for (const col of (p.columns as string[] | null) ?? []) r[col] = null;
          if (p.mode === 'expire') r.status = 'expired';
          affected++;
        }
      }
      this.table('retention_runs').push({ id: this.nextId('retention_runs'), policy_id: p.id, affected_rows: affected, ran_at: this.nowIso(), detail: null });
      total += affected;
    }
    return total;
  }

  async computeTableSizes(): Promise<number> {
    this.rpc('compute_table_sizes');
    const day = this.today();
    let total = 0;
    for (const [name, rows] of Object.entries(this.shared.t)) {
      const bytes = JSON.stringify(rows).length;
      total += bytes;
      this.table('table_sizes_daily').push({ day, table_name: name, total_bytes: bytes, row_estimate: rows.length });
    }
    if (this.shared.sizeOverride !== null) total = this.shared.sizeOverride;
    if (total > 350 * MB) this.insertAlert('ops', 'warning', null, null, `Veritabanı boyutu ${Math.round(total / MB)} MB`, this.nowIso(), {});
    if (total > 450 * MB) {
      const r = this.table('runtime_flags').find((x) => x.key === 'storage_pressure');
      if (r) r.value = true;
      for (const c of this.table('tg_chats')) c.retention_days = 60;
    }
    return total;
  }

  async recomputeIsMinor(): Promise<number> {
    this.rpc('recompute_is_minor');
    const year = this.now().getUTCFullYear();
    let n = 0;
    for (const st of this.table('students')) {
      const pii = this.table('secure.student_pii').find((p) => p.student_id === st.id);
      const by = pii?.birth_year;
      const minor = typeof by !== 'number' || year - by < 18;
      if (st.is_minor !== minor) {
        st.is_minor = minor;
        n++;
      }
    }
    return n;
  }

  async ping(): Promise<number> {
    this.rpc('ping');
    return 1;
  }

  async pendingStorageDeletions(limit: number): Promise<StorageDeletion[]> {
    return this.table('storage_deletions')
      .filter((r) => r.done_at === null || r.done_at === undefined)
      .slice(0, limit)
      .map((r) => ({ id: num(r.id), bucket: String(r.bucket), path: String(r.path) }));
  }

  async markStorageDeletion(id: number, at: string, error: string | null): Promise<void> {
    const r = this.table('storage_deletions').find((x) => x.id === id);
    if (r) Object.assign(r, error === null ? { done_at: at } : { error });
  }
}

/** Bilinen ikili gözlem türleri (testlerde kullanılır). */
export const BINARY_OBSERVATION_KINDS: ReadonlySet<string> = BINARY_KINDS;
