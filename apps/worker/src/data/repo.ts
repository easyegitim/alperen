/**
 * Db arayüzü: Worker'ın veritabanından istediği her şey (BLUEPRINT §3.9 RPC'leri + §3.8'de `bot_runtime`
 * rolüne açık tablo işlemleri). İki uygulama: `PostgrestDb` (canlı, PostgREST + `SUPABASE_BOT_JWT`) ve
 * `FakeDb` (fixtures/db/dev-seed.json; RPC eşlenikleri, RLS taklidi).
 *
 * Öğrenci kapsamı: `forStudent(id)` aynı bağlantının `X-Ogrenmen-Student: <id>` başlıklı kopyasını
 * döner; öğrenci satırına dokunan her çağrı bu kapsamla yapılır. Başlıksız kopya yalnız sohbet, grup
 * ve cron işlemleri içindir (çapraz öğrenci işlemleri adlandırılmış RPC'lerle).
 */

export type ChatKind = 'private' | 'group' | 'supergroup';
export type ChatRoleName = 'student' | 'instructor' | 'coordinator' | 'observer' | 'other' | 'bot';
export type SessionState = 'new' | 'awaiting_consent' | 'awaiting_guardian' | 'diagnostic' | 'idle' | 'awaiting_answer' | 'test';
export type Mode = 'socratic' | 'direct';
export type BotPurpose = 'chat' | 'feedback' | 'hint' | 'command' | 'proactive' | 'escalation' | 'quota' | 'consent' | 'degraded';
export type EscalationReason =
  | 'bot_unsure'
  | 'human_requested'
  | 'grade_attendance_payment'
  | 'quota_exhausted'
  | 'consent_missing'
  | 'degraded'
  | 'deletion_request';

/** Veritabanı hatası; `code` mesajın ilk 12 karakteri (`OGR-AUTH-001`) ya da PostgREST kodu. */
export class DbError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message.startsWith(code) ? message : `${code} ${message}`);
    this.code = code;
    this.status = status;
    this.name = 'DbError';
  }
}

/** Mesajın ilk 12 karakterinden OGR kodu (§3.9: "Worker ve pipelines kodu mesajın ilk 12 karakterini eşler"). */
export function ogrCode(message: string): string | null {
  const head = message.slice(0, 12);
  return /^OGR-[A-Z]+-\d{3}$/.test(head) ? head : null;
}

export interface TgChatRow {
  chat_id: number;
  kind: ChatKind;
  title: string | null;
  bot_is_admin: boolean;
  bot_can_pin: boolean;
  recording_notice_msg_id: number | null;
  recording_notice_legal_id: string | null;
  privacy_mode_off_verified: boolean;
  retention_days: number;
  recording_notice_days: number | null;
  group_auto_answer_min: number;
}

export interface ChatRoleRow {
  chat_id: number;
  telegram_user_id: number;
  role: ChatRoleName;
  student_id: string | null;
  staff_id: string | null;
  mention_handle: string | null;
  joined_at: string;
}

export interface StaffHandle {
  staff_id: string;
  role: 'instructor' | 'coordinator' | 'observer';
  subject: string | null;
  mention_handle: string | null;
  telegram_user_id: number;
}

export interface Identity {
  student_id: string | null;
  public_ref: string | null;
  is_minor: boolean | null;
  status: string | null;
  enrollment_id: string | null;
  consent_ok: boolean;
  role_in_chat: ChatRoleName | null;
  staff_id: string | null;
  tier: string | null;
  service_level: 'ai_only' | 'ai_plus_advisor' | null;
}

export interface ResolveArgs {
  tgUser: number;
  chat: number;
  username: string | null;
  isGroup: boolean;
  create: boolean;
  firstName: string | null;
  lastName: string | null;
}

export interface SessionRow {
  student_id: string;
  chat_id: number;
  state: SessionState;
  mode: Mode;
  direct_once: boolean;
  pending_question_id: string | null;
  diagnostic_session_id: string | null;
  hint_level: number;
  last_activity_at: string;
  quota_warned_on: string | null;
}

export interface PreferencesRow {
  student_id: string;
  default_mode: Mode;
  proactive_enabled: boolean;
  explanation_notes: string | null;
  active_hours: number[];
}

export interface MessageInsert {
  chat_id: number;
  telegram_message_id: number;
  sender_role: ChatRoleName;
  student_id: string | null;
  staff_id: string | null;
  reply_to_telegram_message_id: number | null;
  text_raw: string | null;
  text_llm: string | null;
  attachments: unknown[];
  mentions_bot: boolean;
  is_question: boolean | null;
  sent_at: string;
}

export interface MessageRow extends MessageInsert {
  id: number;
  answered_at: string | null;
}

export interface RecentMessage {
  id: number;
  sender_role: string;
  text: string;
  sent_at: string;
}

export interface QuotaResult {
  allowed: boolean;
  used: number;
  daily_limit: number;
  remaining: number;
  warn: boolean;
}

export interface SpendState {
  paid_allowed: boolean;
  degraded: boolean;
  day_usd: number;
  month_usd: number;
  daily_cap: number;
  monthly_cap: number;
  state: 'normal' | 'free_only' | 'degraded';
  lesson_month_usd: number;
  lesson_cap: number;
}

export interface ProviderHealthRow {
  provider: string;
  cooldown_until: string | null;
  consecutive_errors: number;
  daily_units_used: number;
  daily_units_day: string | null;
  last_error: string | null;
}

export interface GradeResult {
  is_correct: boolean;
  misconception_tag: string | null;
  feedback_student: string | null;
  feedback_pool_id: string | null;
  mastery_p: number | null;
  evidence_count: number | null;
  is_reliable: boolean;
  prereq_hint: string | null;
}

export interface PublicOption {
  key: string;
  text: string;
}

export interface DiagnosticItem {
  question_id: string;
  stem: string;
  figure_png: string | null;
  alt_text: string | null;
  options: PublicOption[];
  idx: number;
  total: number;
}

export interface DiagnosticResult {
  per_skill: Array<{ skill_id: string; name: string; p: number; n: number; reliable: boolean }> | null;
  weakest: string[] | null;
  open_tags: string[];
}

export interface PracticeItem {
  question_id: string;
  stem: string;
  figure_png: string | null;
  alt_text: string | null;
  options: PublicOption[] | null;
  skill_id: string;
  kind: 'mcq' | 'numeric';
}

export interface QuestionPublic {
  id: string;
  curriculum_id: string;
  skill_ids: string[];
  kind: 'mcq' | 'numeric';
  stem: string;
  figure_id: string | null;
  options: PublicOption[] | null;
}

export interface MasteryViewRow {
  skill_id: string;
  skill_name: string;
  p: number;
  evidence_count: number;
  is_reliable: boolean;
  band: string;
}

export interface MemoryHit {
  fact_id: number;
  kind: string;
  text: string;
  valid_until: string | null;
  approved: boolean;
  score: number;
}

export interface PromptProfile {
  weak: Array<{ skill_id: string; name: string; band: string }>;
  misconceptions: string[];
  prereq_hint: string | null;
  explanation_notes: string | null;
  weekly_line: string | null;
}

export interface ApprovedFact {
  source: 'memory_fact' | 'instructor_note';
  id: string;
  text: string;
}

export interface ObservationContext {
  skill_id: string;
  misconception_tag: string | null;
}

export interface PoolRow {
  id: string;
  kind: string;
  skill_id: string;
  misconception_tag: string | null;
  mode: Mode;
  body: string;
}

export interface PoolCandidate {
  kind: 'explanation';
  curriculum_id: string;
  skill_id: string;
  misconception_tag: string | null;
  mode: Mode;
  body: string;
  model: string | null;
  cost_usd: number;
}

export interface LegalText {
  id: string;
  kind: string;
  version: string;
  body_md: string;
}

export interface EnrollmentRow {
  id: string;
  student_id: string;
  curriculum_id: string;
  period_label: string;
}

export interface ProactiveRow {
  id: string;
  student_id: string;
  recipient: 'student' | 'guardian';
  chat_id: number | null;
  template_id: string;
  params: Record<string, unknown>;
}

export interface AutoAnswerRow {
  chat_id: number;
  message_id: number;
  student_id: string;
  telegram_message_id: number;
}

export interface PriorityPlanRow {
  rank: number;
  topic: string;
  kind: string;
  years: number;
  hits: number;
  points_text: string;
  evidence_count: number;
  skill_id?: string | null;
}

export interface PriorityPlan {
  course_code: string;
  period: string;
  years_total: number;
  rows: PriorityPlanRow[];
}

export interface ResearchCitation {
  ordinal: number;
  doi: string | null;
  title: string;
  authors: string | null;
  venue: string | null;
  year: number | null;
  crossref_status: string;
  oa_pdf_url: string | null;
  status: string;
}

export interface ResearchRelease {
  output_id: string;
  synthesis: Array<{ text: string; cites: number[] }>;
  citations: ResearchCitation[];
}

export interface OpsAlertInput {
  detail: string;
  severity: 'danger' | 'warning' | 'neutral';
  ref: Record<string, unknown>;
  student_id?: string | null;
}

export interface StorageDeletion {
  id: number;
  bucket: string;
  path: string;
}

export interface SpendLedgerRow {
  day: string;
  purpose: string;
  provider: string;
  calls: number;
  cost_usd: number;
}

export interface QuotaUsageRow {
  kind: string;
  used: number;
}

export interface QuotaLimitRow {
  kind: string;
  daily_limit: number;
}

export interface SessionAttemptStats {
  total: number;
  correct: number;
  attempted_question_ids: string[];
}

export interface Db {
  /** Bu kopyanın `X-Ogrenmen-Student` değeri (null = başlıksız). */
  readonly student: string | null;
  forStudent(studentId: string | null): Db;

  // Giriş, sohbet kaydı, roller
  dedupUpdate(updateId: number): Promise<boolean>;
  upsertChat(row: { chat_id: number; kind: ChatKind; title: string | null }): Promise<TgChatRow>;
  getChat(chatId: number): Promise<TgChatRow | null>;
  updateChat(chatId: number, patch: Partial<Omit<TgChatRow, 'chat_id' | 'kind'>>): Promise<void>;
  chatsWithStaleNotice(): Promise<TgChatRow[]>;
  getChatRole(chatId: number, tgUserId: number): Promise<ChatRoleRow | null>;
  upsertChatRole(row: Omit<ChatRoleRow, 'joined_at'> & { joined_at?: string }): Promise<void>;
  chatStaff(chatId: number): Promise<StaffHandle[]>;

  // Kimlik ve onay
  resolveTelegram(args: ResolveArgs): Promise<Identity>;
  recordStudentConsent(kind: 'kvkk_aydinlatma' | 'grup_kayit', legalTextId: string, evidence: Record<string, unknown>): Promise<string>;
  redeemGuardianCode(code: string, guardianTg: number, evidence: Record<string, unknown>): Promise<boolean>;
  redeemStaffCode(code: string, tgUser: number, username: string): Promise<boolean>;
  setBirthYear(year: number): Promise<boolean>;
  nameTokenHashes(chatId: number): Promise<string[]>;
  requestDeletion(): Promise<void>;
  getEnrollment(enrollmentId: string): Promise<EnrollmentRow | null>;
  /** Cron yolları için öğrenci kapsamında kimlik (Telegram kimliği olmadan): students + enrollments + `consent_ok`. */
  identityForStudent(chatId: number): Promise<Identity>;

  // Ayarlar
  settings(): Promise<Record<string, unknown>>;
  runtimeFlags(): Promise<Record<string, unknown>>;
  setRuntimeFlag(key: string, value: unknown): Promise<void>;
  latestLegalText(kind: string): Promise<LegalText | null>;
  curriculumSkills(curriculumId: string): Promise<Array<{ id: string; name: string }>>;
  misconceptionText(tag: string): Promise<string | null>;

  // Oturum ve tercih
  getSession(chatId: number): Promise<SessionRow | null>;
  upsertSession(row: Partial<SessionRow> & { chat_id: number }): Promise<SessionRow>;
  getPreferences(): Promise<PreferencesRow | null>;
  updatePreferences(patch: Partial<Omit<PreferencesRow, 'student_id'>>): Promise<void>;

  // Mesajlar
  insertMessage(row: MessageInsert, opts: { returnId: boolean }): Promise<number | null>;
  /** Bu sohbette son gönderilen pratik sorusunun set kimliği (`messages.attachments` `practice_set`). */
  lastPracticeSetId(chatId: number): Promise<string | null>;
  updateMessageText(chatId: number, telegramMessageId: number, patch: { text_raw: string | null; text_llm: string | null; is_question: boolean | null }): Promise<void>;
  markMessageAnswered(messageId: number, at: string): Promise<void>;
  getMessage(messageId: number): Promise<MessageRow | null>;
  recentMessages(chatId: number, n: number): Promise<RecentMessage[]>;

  // Kota ve harcama
  consumeQuota(kind: string): Promise<QuotaResult>;
  consumeStaffQuota(chatId: number, tgUser: number, kind: string): Promise<QuotaResult>;
  quotaUsage(day: string): Promise<QuotaUsageRow[]>;
  quotaLimits(tier: string): Promise<QuotaLimitRow[]>;
  checkSpend(purpose: string): Promise<SpendState>;
  /** `spend_ledger` satırları (bot_runtime: bugün + ay). */
  spendLedger(fromDay: string): Promise<SpendLedgerRow[]>;
  providerHealth(): Promise<ProviderHealthRow[]>;
  updateProviderHealth(provider: string, patch: Partial<Omit<ProviderHealthRow, 'provider'>>): Promise<void>;

  // Puanlama, teşhis, pratik
  gradeAttempt(enrollmentId: string, questionId: string, chosen: { key?: string; value?: string }, context: 'diagnostic' | 'practice' | 'test', sessionId: string | null, responseMs: number | null): Promise<GradeResult>;
  revealSolution(enrollmentId: string, questionId: string): Promise<string | null>;
  diagnosticStatus(enrollmentId: string): Promise<'none' | 'in_progress' | 'finished'>;
  startDiagnostic(enrollmentId: string, chatId: number): Promise<string>;
  nextDiagnosticItem(sessionId: string): Promise<DiagnosticItem | null>;
  advanceDiagnostic(sessionId: string): Promise<number>;
  finishDiagnostic(sessionId: string): Promise<DiagnosticResult>;
  nextPracticeItems(enrollmentId: string, n: number): Promise<PracticeItem[]>;
  questionPublic(questionId: string): Promise<QuestionPublic | null>;
  sessionAttempts(sessionId: string): Promise<SessionAttemptStats>;
  masteryView(enrollmentId: string): Promise<MasteryViewRow[]>;

  // Hafıza, profil, havuz
  retrieveMemory(embedding: number[] | null, text: string, k: number): Promise<MemoryHit[]>;
  profileForPrompt(enrollmentId: string): Promise<PromptProfile>;
  approvedFacts(enrollmentId: string): Promise<ApprovedFact[]>;
  lastObservationContext(enrollmentId: string): Promise<ObservationContext | null>;
  findPool(q: { curriculum_id: string; kind: string; skill_id: string; misconception_tag: string | null; mode: Mode }): Promise<PoolRow | null>;
  /** `content_pool` satırı kimliğiyle (yalnız `approved`; `grade_attempt.feedback_pool_id`). */
  poolById(poolId: string): Promise<PoolRow | null>;
  poolHit(poolId: string): Promise<void>;
  insertPoolCandidate(row: PoolCandidate): Promise<void>;
  recordChatObservation(enrollmentId: string, skillId: string, kind: 'chat_question' | 'chat_misconception', messageId: number, quote: string, tag: string | null): Promise<number>;

  // Günlük
  logBotResponse(payload: Record<string, unknown>): Promise<number>;
  setOutMessage(responseId: number, telegramMessageId: number): Promise<void>;

  // Gruplar, yükseltme, alarm
  openEscalation(chatId: number, messageId: number | null, reason: EscalationReason, questionText: string | null): Promise<string>;
  markAnswered(chatId: number, replyToTelegramMessageId: number, staffTg: number): Promise<void>;
  openOpsAlert(alert: OpsAlertInput): Promise<void>;
  closeOpsAlert(detail: string, ref: Record<string, unknown>): Promise<void>;

  // Proaktif, araştırma, öncelik
  dueProactive(now: string): Promise<ProactiveRow[]>;
  markProactive(id: string, status: 'sent' | 'skipped' | 'failed', telegramMessageId: number | null, at: string): Promise<void>;
  enqueueResearch(query: string): Promise<string>;
  researchRelease(outputId: string): Promise<ResearchRelease | null>;
  priorityPlanForEnrollment(enrollmentId: string): Promise<PriorityPlan | null>;

  // Cron
  cronOpenAlerts(): Promise<number>;
  cronIdleSessions(): Promise<number>;
  cronGroupAutoAnswer(): Promise<AutoAnswerRow[]>;
  runRetention(): Promise<number>;
  computeTableSizes(): Promise<number>;
  recomputeIsMinor(): Promise<number>;
  ping(): Promise<number>;
  pendingStorageDeletions(limit: number): Promise<StorageDeletion[]>;
  markStorageDeletion(id: number, at: string, error: string | null): Promise<void>;
}
