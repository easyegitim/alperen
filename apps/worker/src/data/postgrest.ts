/**
 * PostgREST istemcisi (canlı): `SUPABASE_BOT_JWT` (rol `bot_runtime`, çevrimdışı basılır), `apikey`
 * başlığı, öğrenci kapsamında `X-Ogrenmen-Student`. RPC'ler `POST /rest/v1/rpc/<ad>`; tablo işlemleri
 * yalnız §3.8'de `bot_runtime`'a açık sütunlarla. Yazımlarda `Prefer: return=minimal`.
 * Hata mesajının ilk 12 karakteri OGR kodudur (§3.9) → `DbError.code`.
 *
 * Çağrılan RPC adları `this.rpc('<ad>'` biçiminde yazılır; `test/rpc-names.json` bu listeyle
 * birebir eşleşir (rpc-names testi kaynağı tarar, M13 migration'larla eşler).
 */
import type { FetchFn } from '../telegram/client.ts';
import { toHalfvec } from './embeddings.ts';
import {
  DbError,
  ogrCode,
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
  type ProactiveRow,
  type PromptProfile,
  type ProviderHealthRow,
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

export interface PostgrestOptions {
  url: string;
  anonKey: string;
  botJwt: string;
  fetch: FetchFn;
  clock: { now(): Date };
  timeoutMs?: number;
}

type Row = Record<string, unknown>;

const CHAT_COLS = 'chat_id,kind,title,bot_is_admin,bot_can_pin,recording_notice_msg_id,recording_notice_legal_id,privacy_mode_off_verified,retention_days,recording_notice_days,group_auto_answer_min';
const SESSION_COLS = 'student_id,chat_id,state,mode,direct_once,pending_question_id,diagnostic_session_id,hint_level,last_activity_at,quota_warned_on';
const MESSAGE_COLS = 'id,chat_id,telegram_message_id,sender_role,student_id,staff_id,reply_to_telegram_message_id,text_llm,attachments,mentions_bot,is_question,answered_at,sent_at';

function enc(v: string | number | boolean): string {
  return encodeURIComponent(String(v));
}
function first<T>(rows: unknown): T | null {
  return Array.isArray(rows) && rows.length > 0 ? (rows[0] as T) : null;
}
function numOr(v: unknown, d: number): number {
  return typeof v === 'number' ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d;
}

export class PostgrestDb implements Db {
  readonly student: string | null;
  private readonly o: PostgrestOptions;

  constructor(opts: PostgrestOptions, student: string | null = null) {
    this.o = { ...opts, url: opts.url.replace(/\/+$/, '') };
    this.student = student;
  }

  forStudent(studentId: string | null): Db {
    return new PostgrestDb(this.o, studentId);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      apikey: this.o.anonKey,
      authorization: `Bearer ${this.o.botJwt}`,
      'content-type': 'application/json',
      accept: 'application/json',
      ...extra,
    };
    if (this.student !== null) h['x-ogrenmen-student'] = this.student;
    return h;
  }

  private async request(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await this.o.fetch(`${this.o.url}/rest/v1/${path}`, {
        method,
        headers: this.headers(extra),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 8000),
      });
    } catch (err) {
      throw new DbError('DB-DOWN', `PostgREST'e ulaşılamadı: ${String(err)}`, 503);
    }
    const text = await res.text();
    let data: unknown = null;
    if (text !== '') {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const msg = typeof data === 'object' && data !== null && typeof (data as Row).message === 'string' ? String((data as Row).message) : String(text);
      const code = ogrCode(msg) ?? (typeof data === 'object' && data !== null && typeof (data as Row).code === 'string' ? String((data as Row).code) : `HTTP-${res.status}`);
      throw new DbError(res.status >= 500 ? 'DB-DOWN' : code, msg, res.status);
    }
    return data;
  }

  private rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.request('POST', `rpc/${name}`, args) as Promise<T>;
  }
  private select<T>(table: string, query: string): Promise<T[]> {
    return this.request('GET', `${table}?${query}`) as Promise<T[]>;
  }
  private async insert(table: string, row: unknown, opts: { returnCols?: string; onConflict?: string; ignoreDuplicates?: boolean; merge?: boolean } = {}): Promise<unknown> {
    const prefer: string[] = [opts.returnCols === undefined ? 'return=minimal' : 'return=representation'];
    if (opts.ignoreDuplicates) prefer.push('resolution=ignore-duplicates');
    if (opts.merge) prefer.push('resolution=merge-duplicates');
    const q: string[] = [];
    if (opts.onConflict !== undefined) q.push(`on_conflict=${opts.onConflict}`);
    if (opts.returnCols !== undefined) q.push(`select=${opts.returnCols}`);
    return this.request('POST', `${table}${q.length > 0 ? '?' + q.join('&') : ''}`, row, { prefer: prefer.join(',') });
  }
  private patch(table: string, filter: string, patch: unknown): Promise<unknown> {
    return this.request('PATCH', `${table}?${filter}`, patch, { prefer: 'return=minimal' });
  }
  private requireStudent(): string {
    if (this.student === null) throw new DbError('OGR-AUTH-001', 'öğrenci başlığı yok', 403);
    return this.student;
  }

  // ---------------------------------------------------------------- giriş, sohbet kaydı
  async dedupUpdate(updateId: number): Promise<boolean> {
    return (await this.rpc<boolean>('dedup_update', { p_update_id: updateId })) === true;
  }
  async upsertChat(row: { chat_id: number; kind: ChatKind; title: string | null }): Promise<TgChatRow> {
    await this.insert('tg_chats', row, { onConflict: 'chat_id', ignoreDuplicates: true });
    const got = await this.getChat(row.chat_id);
    if (got === null) throw new DbError('DB-ROW', 'tg_chats satırı okunamadı', 500);
    return got;
  }
  async getChat(chatId: number): Promise<TgChatRow | null> {
    return first<TgChatRow>(await this.select('tg_chats', `select=${CHAT_COLS}&chat_id=eq.${enc(chatId)}`));
  }
  async updateChat(chatId: number, patch: Partial<TgChatRow>): Promise<void> {
    await this.patch('tg_chats', `chat_id=eq.${enc(chatId)}`, patch);
  }
  async chatsWithStaleNotice(): Promise<TgChatRow[]> {
    const rows = await this.select<TgChatRow>('tg_chats', `select=${CHAT_COLS}&kind=neq.private`);
    return rows.filter((c) => c.recording_notice_days !== c.retention_days);
  }
  async getChatRole(chatId: number, tgUserId: number): Promise<ChatRoleRow | null> {
    return first<ChatRoleRow>(
      await this.select('chat_roles', `select=chat_id,telegram_user_id,role,student_id,staff_id,mention_handle,joined_at&chat_id=eq.${enc(chatId)}&telegram_user_id=eq.${enc(tgUserId)}`),
    );
  }
  async upsertChatRole(row: Omit<ChatRoleRow, 'joined_at'> & { joined_at?: string }): Promise<void> {
    await this.insert('chat_roles', row, { onConflict: 'chat_id,telegram_user_id', merge: true });
  }
  async chatStaff(chatId: number): Promise<StaffHandle[]> {
    const roles = await this.select<ChatRoleRow>('chat_roles', `select=telegram_user_id,staff_id,mention_handle&chat_id=eq.${enc(chatId)}&staff_id=not.is.null`);
    if (roles.length === 0) return [];
    const ids = roles.map((r) => r.staff_id).filter((x): x is string => typeof x === 'string');
    // §3.8: bot_runtime `staff` tablosunda yalnız (id, role, subject) okur; `active` sütun yetkisinde yok.
    // Pasif personelin chat_roles bağı koordinatör tarafından kaldırılır; tanıtıcı yalnız chat_roles'tan gelir.
    const staff = await this.select<{ id: string; role: StaffHandle['role']; subject: string | null }>('staff', `select=id,role,subject&id=in.(${ids.map(enc).join(',')})`);
    const out: StaffHandle[] = [];
    for (const r of roles) {
      const st = staff.find((x) => x.id === r.staff_id);
      if (st) out.push({ staff_id: st.id, role: st.role, subject: st.subject, mention_handle: r.mention_handle, telegram_user_id: r.telegram_user_id });
    }
    return out;
  }

  // ---------------------------------------------------------------- kimlik ve onay
  async resolveTelegram(a: ResolveArgs): Promise<Identity> {
    const rows = await this.rpc<Identity[]>('resolve_telegram', {
      p_tg_user: a.tgUser,
      p_chat: a.chat,
      p_username: a.username,
      p_is_group: a.isGroup,
      p_create: a.create,
      p_first_name: a.firstName,
      p_last_name: a.lastName,
    });
    const r = first<Identity>(rows);
    return (
      r ?? {
        student_id: null,
        public_ref: null,
        is_minor: null,
        status: null,
        enrollment_id: null,
        consent_ok: false,
        role_in_chat: null,
        staff_id: null,
        tier: null,
        service_level: null,
      }
    );
  }
  async recordStudentConsent(kind: 'kvkk_aydinlatma' | 'grup_kayit', legalTextId: string, evidence: Record<string, unknown>): Promise<string> {
    return this.rpc<string>('record_student_consent', { p_kind: kind, p_legal_text: legalTextId, p_evidence: evidence });
  }
  async redeemGuardianCode(code: string, guardianTg: number, evidence: Record<string, unknown>): Promise<boolean> {
    return (await this.rpc<boolean>('redeem_guardian_code', { p_code: code, p_guardian_tg: guardianTg, p_evidence: evidence })) === true;
  }
  async redeemStaffCode(code: string, tgUser: number, username: string): Promise<boolean> {
    return (await this.rpc<boolean>('redeem_staff_code', { p_code: code, p_tg_user: tgUser, p_username: username })) === true;
  }
  async setBirthYear(year: number): Promise<boolean> {
    return (await this.rpc<boolean>('set_birth_year', { p_year: year })) === true;
  }
  async nameTokenHashes(chatId: number): Promise<string[]> {
    const r = await this.rpc<string[] | null>('name_token_hashes', { p_chat: chatId });
    return Array.isArray(r) ? r : [];
  }
  async requestDeletion(): Promise<void> {
    this.requireStudent();
    await this.rpc('request_deletion');
  }
  async getEnrollment(enrollmentId: string): Promise<EnrollmentRow | null> {
    this.requireStudent();
    return first<EnrollmentRow>(await this.select('enrollments', `select=id,student_id,curriculum_id,period_label&id=eq.${enc(enrollmentId)}`));
  }

  async identityForStudent(chatId: number): Promise<Identity> {
    const sid = this.requireStudent();
    const st = first<{ public_ref: string; is_minor: boolean; status: string; tier: string }>(await this.select('students', `select=public_ref,is_minor,status,tier&id=eq.${enc(sid)}`));
    const enr = first<{ id: string }>(await this.select('enrollments', `select=id&student_id=eq.${enc(sid)}&status=eq.active&order=started_at.desc&limit=1`));
    const ok = (await this.rpc<boolean>('consent_ok', { p_student: sid })) === true;
    const tier = st === null ? null : first<{ service_level: Identity['service_level'] }>(await this.select('quota_tiers', `select=service_level&tier=eq.${enc(st.tier)}`));
    const cr = first<{ role: Identity['role_in_chat'] }>(await this.select('chat_roles', `select=role&chat_id=eq.${enc(chatId)}&student_id=eq.${enc(sid)}`));
    return {
      student_id: sid,
      public_ref: st?.public_ref ?? null,
      is_minor: st?.is_minor ?? true,
      status: st?.status ?? null,
      enrollment_id: enr?.id ?? null,
      consent_ok: ok,
      role_in_chat: cr?.role ?? 'student',
      staff_id: null,
      tier: st?.tier ?? null,
      service_level: tier?.service_level ?? null,
    };
  }

  // ---------------------------------------------------------------- ayarlar
  async settings(): Promise<Record<string, unknown>> {
    const rows = await this.select<{ key: string; value: unknown }>('settings', 'select=key,value');
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
  async runtimeFlags(): Promise<Record<string, unknown>> {
    const rows = await this.select<{ key: string; value: unknown }>('runtime_flags', 'select=key,value');
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
  async setRuntimeFlag(key: string, value: unknown): Promise<void> {
    await this.rpc('set_runtime_flag', { p_key: key, p_value: value });
  }
  async latestLegalText(kind: string): Promise<LegalText | null> {
    return first<LegalText>(await this.select('legal_texts', `select=id,kind,version,body_md&kind=eq.${enc(kind)}&order=effective_from.desc&limit=1`));
  }
  async curriculumSkills(curriculumId: string): Promise<Array<{ id: string; name: string }>> {
    return this.select('skills', `select=id,name&curriculum_id=eq.${enc(curriculumId)}&is_leaf=is.true`);
  }
  async misconceptionText(tag: string): Promise<string | null> {
    return first<{ text_student: string }>(await this.select('misconception_tags', `select=text_student&tag=eq.${enc(tag)}`))?.text_student ?? null;
  }

  // ---------------------------------------------------------------- oturum ve tercih
  async getSession(chatId: number): Promise<SessionRow | null> {
    const sid = this.requireStudent();
    return first<SessionRow>(await this.select('sessions', `select=${SESSION_COLS}&student_id=eq.${enc(sid)}&chat_id=eq.${enc(chatId)}`));
  }
  async upsertSession(row: Partial<SessionRow> & { chat_id: number }): Promise<SessionRow> {
    const sid = this.requireStudent();
    const rows = await this.insert('sessions', { ...row, student_id: sid }, { onConflict: 'student_id,chat_id', merge: true, returnCols: SESSION_COLS });
    const r = first<SessionRow>(rows);
    if (r === null) throw new DbError('DB-ROW', 'sessions satırı yazılamadı', 500);
    return r;
  }
  async getPreferences(): Promise<PreferencesRow | null> {
    const sid = this.requireStudent();
    return first<PreferencesRow>(await this.select('preferences', `select=student_id,default_mode,proactive_enabled,explanation_notes,active_hours&student_id=eq.${enc(sid)}`));
  }
  async updatePreferences(patch: Partial<Omit<PreferencesRow, 'student_id'>>): Promise<void> {
    const sid = this.requireStudent();
    await this.patch('preferences', `student_id=eq.${enc(sid)}`, patch);
  }

  // ---------------------------------------------------------------- mesajlar
  async insertMessage(row: MessageInsert, opts: { returnId: boolean }): Promise<number | null> {
    const res = await this.insert('messages', row, opts.returnId ? { returnCols: 'id' } : {});
    return opts.returnId ? numOr(first<{ id: number }>(res)?.id, 0) : null;
  }
  async lastPracticeSetId(chatId: number): Promise<string | null> {
    const filter = encodeURIComponent(JSON.stringify([{ kind: 'practice_set' }]));
    const r = first<{ attachments: Array<{ kind?: string; set_id?: string }> | null }>(
      await this.select('messages', `select=attachments&chat_id=eq.${enc(chatId)}&sender_role=eq.bot&attachments=cs.${filter}&order=id.desc&limit=1`),
    );
    const att = (r?.attachments ?? []).find((a) => a.kind === 'practice_set');
    return typeof att?.set_id === 'string' ? att.set_id : null;
  }
  async updateMessageText(chatId: number, telegramMessageId: number, patch: { text_raw: string | null; text_llm: string | null; is_question: boolean | null }): Promise<void> {
    await this.patch('messages', `chat_id=eq.${enc(chatId)}&telegram_message_id=eq.${enc(telegramMessageId)}`, patch);
  }
  async markMessageAnswered(messageId: number, at: string): Promise<void> {
    await this.patch('messages', `id=eq.${enc(messageId)}&answered_at=is.null`, { answered_at: at });
  }
  async getMessage(messageId: number): Promise<MessageRow | null> {
    const r = first<MessageRow>(await this.select('messages', `select=${MESSAGE_COLS}&id=eq.${enc(messageId)}`));
    return r === null ? null : { ...r, text_raw: null };
  }
  async recentMessages(chatId: number, n: number): Promise<RecentMessage[]> {
    return this.rpc<RecentMessage[]>('recent_messages', { p_chat: chatId, p_n: n });
  }

  // ---------------------------------------------------------------- kota ve harcama
  async consumeQuota(kind: string): Promise<QuotaResult> {
    this.requireStudent();
    const r = first<QuotaResult>(await this.rpc('consume_quota', { p_kind: kind }));
    if (r === null) throw new DbError('DB-ROW', 'consume_quota boş döndü', 500);
    return r;
  }
  async consumeStaffQuota(chatId: number, tgUser: number, kind: string): Promise<QuotaResult> {
    const r = first<QuotaResult>(await this.rpc('consume_staff_quota', { p_chat: chatId, p_tg_user: tgUser, p_kind: kind }));
    if (r === null) throw new DbError('DB-ROW', 'consume_staff_quota boş döndü', 500);
    return r;
  }
  async quotaUsage(day: string): Promise<QuotaUsageRow[]> {
    const sid = this.requireStudent();
    return this.select('quota_usage', `select=kind,used&student_id=eq.${enc(sid)}&day=eq.${enc(day)}`);
  }
  async quotaLimits(tier: string): Promise<QuotaLimitRow[]> {
    return this.select('quota_limits', `select=kind,daily_limit&tier=eq.${enc(tier)}`);
  }
  async checkSpend(purpose: string): Promise<SpendState> {
    const r = first<SpendState>(await this.rpc('check_spend', { p_purpose: purpose }));
    if (r === null) throw new DbError('DB-ROW', 'check_spend boş döndü', 500);
    return {
      ...r,
      day_usd: numOr(r.day_usd, 0),
      month_usd: numOr(r.month_usd, 0),
      daily_cap: numOr(r.daily_cap, 0),
      monthly_cap: numOr(r.monthly_cap, 0),
      lesson_month_usd: numOr(r.lesson_month_usd, 0),
      lesson_cap: numOr(r.lesson_cap, 0),
    };
  }
  async spendLedger(fromDay: string): Promise<SpendLedgerRow[]> {
    const rows = await this.select<SpendLedgerRow>('spend_ledger', `select=day,purpose,provider,calls,cost_usd&day=gte.${enc(fromDay)}`);
    return rows.map((r) => ({ ...r, calls: numOr(r.calls, 0), cost_usd: numOr(r.cost_usd, 0) }));
  }
  async providerHealth(): Promise<ProviderHealthRow[]> {
    return this.select('provider_health', 'select=provider,cooldown_until,consecutive_errors,daily_units_used,daily_units_day,last_error');
  }
  async updateProviderHealth(provider: string, patch: Partial<Omit<ProviderHealthRow, 'provider'>>): Promise<void> {
    // §3.8: bot_runtime provider_health'te yalnız `r u` — satırlar M02 seed'iyle vardır; INSERT … ON CONFLICT yok.
    await this.patch('provider_health', `provider=eq.${enc(provider)}`, { ...patch, updated_at: this.o.clock.now().toISOString() });
  }

  // ---------------------------------------------------------------- puanlama, teşhis, pratik
  async gradeAttempt(
    enrollmentId: string,
    questionId: string,
    chosen: { key?: string; value?: string },
    context: 'diagnostic' | 'practice' | 'test',
    sessionId: string | null,
    responseMs: number | null,
  ): Promise<GradeResult> {
    this.requireStudent();
    const r = first<GradeResult>(
      await this.rpc('grade_attempt', { p_enrollment: enrollmentId, p_question: questionId, p_chosen: chosen, p_context: context, p_session: sessionId, p_response_ms: responseMs }),
    );
    if (r === null) throw new DbError('DB-ROW', 'grade_attempt boş döndü', 500);
    return { ...r, mastery_p: r.mastery_p === null ? null : numOr(r.mastery_p, 0) };
  }
  async revealSolution(enrollmentId: string, questionId: string): Promise<string | null> {
    this.requireStudent();
    return this.rpc<string | null>('reveal_solution', { p_enrollment: enrollmentId, p_question: questionId });
  }
  async diagnosticStatus(enrollmentId: string): Promise<'none' | 'in_progress' | 'finished'> {
    this.requireStudent();
    const rows = await this.select<{ status: string; started_at: string }>('diagnostic_sessions', `select=status,started_at&enrollment_id=eq.${enc(enrollmentId)}`);
    if (rows.some((r) => r.status === 'finished')) return 'finished';
    const dayAgo = this.o.clock.now().getTime() - 86_400_000;
    return rows.some((r) => r.status === 'in_progress' && Date.parse(r.started_at) > dayAgo) ? 'in_progress' : 'none';
  }
  async startDiagnostic(enrollmentId: string, chatId: number): Promise<string> {
    this.requireStudent();
    return this.rpc<string>('start_diagnostic', { p_enrollment: enrollmentId, p_chat: chatId });
  }
  async nextDiagnosticItem(sessionId: string): Promise<DiagnosticItem | null> {
    this.requireStudent();
    return first<DiagnosticItem>(await this.rpc('next_diagnostic_item', { p_session: sessionId }));
  }
  async advanceDiagnostic(sessionId: string): Promise<number> {
    this.requireStudent();
    return numOr(await this.rpc('advance_diagnostic', { p_session: sessionId }), 0);
  }
  async finishDiagnostic(sessionId: string): Promise<DiagnosticResult> {
    this.requireStudent();
    return this.rpc<DiagnosticResult>('finish_diagnostic', { p_session: sessionId });
  }
  async nextPracticeItems(enrollmentId: string, n: number): Promise<PracticeItem[]> {
    this.requireStudent();
    return this.rpc<PracticeItem[]>('next_practice_items', { p_enrollment: enrollmentId, p_n: n });
  }
  async questionPublic(questionId: string): Promise<QuestionPublic | null> {
    return first<QuestionPublic>(await this.select('questions_public', `select=id,curriculum_id,skill_ids,kind,stem,figure_id,options&id=eq.${enc(questionId)}`));
  }
  async sessionAttempts(sessionId: string): Promise<SessionAttemptStats> {
    this.requireStudent();
    const rows = await this.select<{ question_id: string; is_correct: boolean | null }>('attempts', `select=question_id,is_correct&session_id=eq.${enc(sessionId)}`);
    return { total: rows.length, correct: rows.filter((r) => r.is_correct === true).length, attempted_question_ids: rows.map((r) => r.question_id) };
  }
  async masteryView(enrollmentId: string): Promise<MasteryViewRow[]> {
    this.requireStudent();
    const rows = await this.select<MasteryViewRow>('mastery_view', `select=skill_id,skill_name,p,evidence_count,is_reliable,band&enrollment_id=eq.${enc(enrollmentId)}`);
    return rows.map((r) => ({ ...r, p: numOr(r.p, 0) }));
  }

  // ---------------------------------------------------------------- hafıza, profil, havuz
  async retrieveMemory(embedding: number[] | null, text: string, k: number): Promise<MemoryHit[]> {
    this.requireStudent();
    const rows = await this.rpc<MemoryHit[]>('retrieve_memory', { p_query: embedding === null ? null : toHalfvec(embedding), p_text: text, p_k: k });
    return rows.map((r) => ({ ...r, score: numOr(r.score, 0) }));
  }
  async profileForPrompt(enrollmentId: string): Promise<PromptProfile> {
    this.requireStudent();
    const r = await this.rpc<PromptProfile | null>('profile_for_prompt', { p_enrollment: enrollmentId });
    return r ?? { weak: [], misconceptions: [], prereq_hint: null, explanation_notes: null, weekly_line: null };
  }
  async approvedFacts(enrollmentId: string): Promise<ApprovedFact[]> {
    const sid = this.requireStudent();
    const facts = await this.select<{ id: number; text: string }>(
      'memory_facts',
      `select=id,text&student_id=eq.${enc(sid)}&kind=eq.instructor_fact&approved=is.true&status=eq.active`,
    );
    const notes = await this.select<{ id: string; body: string }>('instructor_notes', `select=id,body&enrollment_id=eq.${enc(enrollmentId)}&approved_fact=is.true`);
    return [
      ...facts.map((f) => ({ source: 'memory_fact' as const, id: String(f.id), text: f.text })),
      ...notes.map((n) => ({ source: 'instructor_note' as const, id: n.id, text: n.body })),
    ];
  }
  async lastObservationContext(enrollmentId: string): Promise<ObservationContext | null> {
    this.requireStudent();
    return first<ObservationContext>(
      await this.select('observations', `select=skill_id,misconception_tag&enrollment_id=eq.${enc(enrollmentId)}&kind=neq.inferred&order=created_at.desc,id.desc&limit=1`),
    );
  }
  async findPool(q: { curriculum_id: string; kind: string; skill_id: string; misconception_tag: string | null; mode: 'socratic' | 'direct' }): Promise<PoolRow | null> {
    const tag = q.misconception_tag === null ? 'misconception_tag=is.null' : `misconception_tag=eq.${enc(q.misconception_tag)}`;
    return first<PoolRow>(
      await this.select(
        'content_pool',
        `select=id,kind,skill_id,misconception_tag,mode,body&status=eq.approved&curriculum_id=eq.${enc(q.curriculum_id)}&kind=eq.${enc(q.kind)}&skill_id=eq.${enc(q.skill_id)}&mode=eq.${enc(q.mode)}&${tag}&limit=1`,
      ),
    );
  }
  async poolById(poolId: string): Promise<PoolRow | null> {
    return first<PoolRow>(await this.select('content_pool', `select=id,kind,skill_id,misconception_tag,mode,body&id=eq.${enc(poolId)}&status=eq.approved`));
  }
  async poolHit(poolId: string): Promise<void> {
    await this.rpc('pool_hit', { p_pool: poolId });
  }
  async insertPoolCandidate(row: PoolCandidate): Promise<void> {
    await this.insert('content_pool', { ...row, status: 'pending_review' }, { ignoreDuplicates: true });
  }
  async recordChatObservation(enrollmentId: string, skillId: string, kind: 'chat_question' | 'chat_misconception', messageId: number, quote: string, tag: string | null): Promise<number> {
    this.requireStudent();
    return numOr(await this.rpc('record_chat_observation', { p_enrollment: enrollmentId, p_skill: skillId, p_kind: kind, p_message: messageId, p_quote: quote, p_tag: tag }), 0);
  }

  // ---------------------------------------------------------------- günlük
  async logBotResponse(payload: Record<string, unknown>): Promise<number> {
    return numOr(await this.rpc('log_bot_response', { p: payload }), 0);
  }
  async setOutMessage(responseId: number, telegramMessageId: number): Promise<void> {
    await this.rpc('set_out_message', { p_response: responseId, p_tg_msg: telegramMessageId });
  }

  // ---------------------------------------------------------------- gruplar, yükseltme, alarm
  async openEscalation(chatId: number, messageId: number | null, reason: EscalationReason, questionText: string | null): Promise<string> {
    return this.rpc<string>('open_escalation', { p_chat: chatId, p_message: messageId, p_reason: reason, p_question_text: questionText });
  }
  async markAnswered(chatId: number, replyToTelegramMessageId: number, staffTg: number): Promise<void> {
    await this.rpc('mark_answered', { p_chat: chatId, p_reply_to_tg_msg: replyToTelegramMessageId, p_staff_tg: staffTg });
  }
  async openOpsAlert(alert: OpsAlertInput): Promise<void> {
    await this.insert(
      'instructor_alerts',
      { kind: 'ops', severity: alert.severity, student_id: alert.student_id ?? null, detail: alert.detail, since: this.o.clock.now().toISOString(), ref: alert.ref },
      { ignoreDuplicates: true },
    ).catch((err: unknown) => {
      if (err instanceof DbError && err.code === '23505') return null; // alerts_dedup: aynı açık alarm zaten var
      throw err;
    });
  }
  async closeOpsAlert(detail: string, ref: Record<string, unknown>): Promise<void> {
    const refFilter = Object.entries(ref)
      .map(([k, v]) => `ref->>${k}=eq.${enc(String(v))}`)
      .join('&');
    await this.patch('instructor_alerts', `kind=eq.ops&status=eq.open&detail=eq.${enc(detail)}${refFilter === '' ? '' : '&' + refFilter}`, {
      status: 'done',
      resolved_at: this.o.clock.now().toISOString(),
    });
  }

  // ---------------------------------------------------------------- proaktif, araştırma, öncelik
  async dueProactive(now: string): Promise<ProactiveRow[]> {
    return this.rpc<ProactiveRow[]>('cron_due_proactive', { p_now: now });
  }
  async markProactive(id: string, status: 'sent' | 'skipped' | 'failed', telegramMessageId: number | null, at: string): Promise<void> {
    await this.patch('proactive_messages', `id=eq.${enc(id)}`, status === 'sent' ? { status, telegram_message_id: telegramMessageId, sent_at: at } : { status });
  }
  async enqueueResearch(query: string): Promise<string> {
    this.requireStudent();
    return this.rpc<string>('enqueue_research', { p_query: query });
  }
  async researchRelease(outputId: string): Promise<ResearchRelease | null> {
    const out = first<{ id: string; output: { synthesis?: Array<{ text: string; cites: number[] }> } }>(
      await this.select('research_outputs', `select=id,output&id=eq.${enc(outputId)}&status=eq.released`),
    );
    if (out === null) return null;
    const cites = await this.select<ResearchRelease['citations'][number]>(
      'citations',
      `select=ordinal,doi,title,authors,venue,year,crossref_status,oa_pdf_url,status&output_id=eq.${enc(outputId)}&status=eq.kept&order=ordinal.asc`,
    );
    return { output_id: out.id, synthesis: out.output.synthesis ?? [], citations: cites };
  }
  async priorityPlanForEnrollment(enrollmentId: string): Promise<PriorityPlan | null> {
    this.requireStudent();
    return this.rpc<PriorityPlan | null>('priority_plan_for_enrollment', { p_enrollment: enrollmentId });
  }

  // ---------------------------------------------------------------- cron
  async cronOpenAlerts(): Promise<number> {
    return numOr(await this.rpc('cron_open_alerts'), 0);
  }
  async cronIdleSessions(): Promise<number> {
    return numOr(await this.rpc('cron_idle_sessions'), 0);
  }
  async cronGroupAutoAnswer(): Promise<AutoAnswerRow[]> {
    return this.rpc<AutoAnswerRow[]>('cron_group_auto_answer');
  }
  async runRetention(): Promise<number> {
    return numOr(await this.rpc('run_retention'), 0);
  }
  async computeTableSizes(): Promise<number> {
    return numOr(await this.rpc('compute_table_sizes'), 0);
  }
  async recomputeIsMinor(): Promise<number> {
    return numOr(await this.rpc('recompute_is_minor'), 0);
  }
  async ping(): Promise<number> {
    return numOr(await this.rpc('ping'), 0);
  }
  async pendingStorageDeletions(limit: number): Promise<StorageDeletion[]> {
    return this.select('storage_deletions', `select=id,bucket,path&done_at=is.null&order=id.asc&limit=${enc(limit)}`);
  }
  async markStorageDeletion(id: number, at: string, error: string | null): Promise<void> {
    // §3.8: bot_runtime yalnız done_at günceller; hata metni yazımı M02 yetkisini bekler (README not 11).
    await this.patch('storage_deletions', `id=eq.${enc(id)}`, error === null ? { done_at: at } : { error });
  }
}

