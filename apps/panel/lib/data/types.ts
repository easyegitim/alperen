// Panel veri katmanı sözleşmesi (BLUEPRINT §7 "Veri erişimi"). Sütun adları §3 migration'larıyla aynıdır.
// live.ts PostgREST + RPC ile (RLS altında), mock.ts fixtures/panel/*.json + fixtures/db/dev-seed.json ile uygular.
import type { ExamPriorityPlan, InstructorAlert, LessonAnalysis, ResearchOutput } from '@ogrenmen/contracts/types';

export type StaffRole = 'coordinator' | 'instructor' | 'observer';

export interface Viewer {
  id: string;
  full_name: string;
  role: StaffRole;
  subject: string | null;
}

// ---------------------------------------------------------------- genel bakış ve alarmlar
export interface OverviewTiles {
  unanswered: number;
  silent: number;
  deadlines: number;
  response_hours: number | null;
}
export interface PilotMetricPoint {
  metric: string;
  period: string;
  value: number | null;
}
export interface Overview {
  tiles: OverviewTiles;
  alerts: InstructorAlert[];
  response_series: { day: string; median_hours: number | null }[];
  pilot: PilotMetricPoint[];
}
export interface AlertItem extends InstructorAlert {
  id: string;
  status: 'open' | 'done' | 'snoozed';
  student_label: string | null;
}

// ---------------------------------------------------------------- ders raporları
export type LessonStatus = 'uploaded' | 'processing' | 'analyzed' | 'approved' | 'corrected' | 'rejected' | 'failed';
export type AnalysisStatus = 'draft' | 'approved' | 'corrected' | 'rejected';
export type ClaimKind =
  | 'skill_mastery'
  | 'misconception'
  | 'question'
  | 'hesitation'
  | 'homework'
  | 'promise'
  | 'deadline'
  | 'next_step'
  | 'followup'
  | 'talk';
export type ClaimStatus = 'pending' | 'approved' | 'edited' | 'rejected';

export interface LessonRow {
  id: string;
  enrollment_id: string;
  staff_id: string | null;
  held_at: string;
  duration_min: number | null;
  video_deleted_at: string | null;
  deletion_notified_at: string | null;
  transcript_path: string | null;
  frames_count: number | null;
  status: LessonStatus;
  created_at: string;
}
export interface LessonAnalysisRow {
  id: string;
  lesson_id: string;
  version: number;
  seed_profile: Record<string, unknown>;
  analysis: LessonAnalysis;
  model: string;
  cost_usd: number;
  status: AnalysisStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}
export interface LessonClaim {
  id: string;
  analysis_id: string;
  kind: ClaimKind;
  curriculum_id: string;
  skill_id: string | null;
  misconception_tag: string | null;
  misconception_id: string | null;
  value: Record<string, unknown>;
  quote: string;
  speaker: 'ÖĞRENCİ' | 'EĞİTMEN';
  t_start_sec: number;
  t_end_sec: number | null;
  status: ClaimStatus;
  edited_value: Record<string, unknown> | null;
  decided_by: string | null;
  decided_at: string | null;
}
export interface LessonListItem {
  analysis_id: string;
  lesson_id: string;
  held_at: string;
  status: AnalysisStatus;
  student_label: string;
  student_ref: string;
  staff_name: string | null;
  created_at: string;
}
export interface MasteryRow {
  skill_id: string;
  skill_name: string;
  p: number;
  evidence_count: number;
  is_reliable: boolean;
  band: 'düşük' | 'orta' | 'yüksek';
  last_evidence_at: string | null;
}
export interface LessonDetail {
  lesson: LessonRow;
  student_label: string;
  student_ref: string;
  staff_name: string | null;
  analysis: LessonAnalysisRow;
  claims: LessonClaim[];
  /** "Ders analizi: 0,41 $ (ayrı bütçe)" */
  cost_line: string;
  skill_names: Record<string, string>;
  /** Öğrencinin bu kazanımlardaki güncel ustalığı (mastery_view) */
  current_mastery: MasteryRow[];
  /** settings.min_evidence */
  min_evidence: number;
}
export interface ClaimDecision {
  claim_id: string;
  status: 'approved' | 'edited' | 'rejected';
  edited_value?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------- bot cevapları
export interface ProviderAttempt {
  provider: string;
  model: string;
  status: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  error_code: string | null;
}
export interface BotResponseRow {
  id: number;
  in_message_id: number | null;
  chat_id: number;
  student_id: string | null;
  purpose: string;
  mode: 'socratic' | 'direct' | null;
  prompt_version: string | null;
  prompt_text: string | null;
  response_text: string;
  memory_fact_ids: number[];
  provider: string | null;
  model: string | null;
  provider_attempts: ProviderAttempt[];
  cost_usd: number;
  confidence: number | null;
  escalated: boolean;
  schema_valid: boolean | null;
  degraded_mode: boolean;
  flagged: boolean;
  flagged_by: string | null;
  flag_reason: string | null;
  flagged_at: string | null;
  review_week: string | null;
  created_at: string;
  student_label: string | null;
  student_ref: string | null;
  /** Öğrencinin gelen mesajı: E/K için v_messages_staff.text_raw, gözlemci için messages.text_llm */
  in_text: string | null;
}
export interface BotResponseFilter {
  week?: string | null;
  flaggedOnly?: boolean;
  studentRef?: string | null;
}

// ---------------------------------------------------------------- inceleme kuyruğu
export type QueueKind =
  | 'question'
  | 'figure'
  | 'misconception'
  | 'pool'
  | 'lesson_analysis'
  | 'flagged_response'
  | 'priority_plan'
  | 'research';
export interface QueueRow {
  kind: QueueKind;
  ref_id: string;
  created_at: string;
  reason: string;
  student_ref: string | null;
  staff_hint: string | null;
}
export interface QuestionOption {
  key: string;
  text: string;
  misconception_tag: string | null;
}
export interface QuestionRow {
  id: string;
  curriculum_id: string;
  skill_ids: string[];
  kind: string;
  stem: string;
  figure_id: string | null;
  options: QuestionOption[];
  difficulty: number | null;
  source: 'template' | 'llm' | 'instructor' | string;
  verification: { schema?: boolean; sympy?: string; render?: string; vision?: string; attempts?: number } | null;
  status: string;
  model: string | null;
  review_note: string | null;
  created_at: string;
}
export interface FigureRow {
  id: string;
  tool: string;
  alt_text: string;
  png_path: string | null;
  width_px: number | null;
  height_px: number | null;
  render_status: string;
  vision_status: string;
  vision_report: Record<string, unknown> | null;
  /** §3.4 check kısıtı: yalnız bu üç değer. */
  review_status: 'pending' | 'verified' | 'rejected';
  render_log: string | null;
}
export interface MisconceptionRow {
  id: string;
  enrollment_id: string;
  skill_id: string;
  tag: string | null;
  text_instructor: string;
  text_student: string;
  status: string;
  evidence_count: number;
  first_seen: string;
  last_seen: string | null;
  resolved_at: string | null;
}
export interface EvidenceItem {
  observation_id: number;
  quote: string | null;
  source_locator: string | null;
  kind: string;
  created_at: string;
}
export interface PoolRow {
  id: string;
  kind: string;
  skill_id: string;
  misconception_tag: string | null;
  mode: string | null;
  body: string;
  status: string;
  hit_count: number;
}
export interface PriorityPlanRow {
  id: string;
  course_id: string;
  course_code: string;
  period: string;
  plan: ExamPriorityPlan;
  evidence_count: number;
  status: 'pending_review' | 'approved' | 'retired';
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}
export interface CitationRow {
  id: string;
  output_id: string;
  ordinal: number;
  doi: string | null;
  title: string;
  authors: string | null;
  venue: string | null;
  year: number | null;
  crossref_status: 'pending' | 'verified' | 'unresolved' | 'no_doi';
  oa_pdf_url: string | null;
  tldr: string | null;
  status: 'kept' | 'removed';
  relevance: 0 | 1 | 2 | null;
}
export interface ResearchDetail {
  id: string;
  status: 'pending_review' | 'released' | 'rejected';
  output: ResearchOutput;
  citations: CitationRow[];
}

export type QueueDetail =
  | { kind: 'question'; question: QuestionRow; figure: FigureRow | null; figure_url: string | null }
  | { kind: 'figure'; figure: FigureRow; figure_url: string | null; used_by: QuestionRow[] }
  | { kind: 'misconception'; misconception: MisconceptionRow; evidence: EvidenceItem[]; student_label: string | null }
  | { kind: 'pool'; pool: PoolRow }
  | { kind: 'lesson_analysis'; analysis_id: string; student_label: string | null }
  | { kind: 'flagged_response'; response: BotResponseRow }
  | { kind: 'priority_plan'; plan: PriorityPlanRow }
  | { kind: 'research'; research: ResearchDetail };

export interface AnswerKeyPeek {
  correct_option: string | null;
  numeric_value: string | null;
  solution: string | null;
  sympy_status: 'verified' | 'not_applicable' | 'failed' | 'pending' | string;
}
export interface NewQuestion {
  skill_id: string;
  stem: string;
  options: QuestionOption[];
  correct_option: string;
  solution: string;
  difficulty: number;
}

// ---------------------------------------------------------------- öğrenciler
export interface StudentListItem {
  student_id: string;
  public_ref: string;
  label: string;
  status: string;
  is_minor: boolean;
  tier: string;
  consent_ok: boolean;
  assigned_staff: string[];
}
export interface QuotaRow {
  day: string;
  kind: string;
  used: number;
  daily_limit: number | null;
}
export interface AttemptRow {
  id: number;
  question_id: string;
  stem: string | null;
  context: string;
  is_correct: boolean | null;
  misconception_tag: string | null;
  graded_at: string | null;
}
export interface WeeklySummaryRow {
  week_start: string;
  body: string;
  metrics: Record<string, unknown>;
}
export interface StudentDetail {
  student_id: string;
  public_ref: string;
  label: string;
  status: string;
  is_minor: boolean;
  tier: string;
  enrollment_id: string;
  curriculum_id: string;
  period: string;
  min_evidence: number;
  mastery: MasteryRow[];
  open_misconceptions: (MisconceptionRow & { evidence: EvidenceItem[] })[];
  weekly_summary: WeeklySummaryRow | null;
  quota: QuotaRow[];
  recent_attempts: AttemptRow[];
  notes: { id: string; body: string; skill_id: string | null; author: string | null; created_at: string }[];
  skills: { id: string; name: string }[];
}
export interface NoteInput {
  enrollment_id: string;
  skill_id: string | null;
  body: string;
  mastery_estimate: number | null;
  approved_fact: boolean;
}

// ---------------------------------------------------------------- onaylar
export type ConsentKind = 'kvkk_aydinlatma' | 'veli_onayi' | 'grup_kayit' | 'ders_kaydi';
export interface ConsentRow {
  id: string;
  student_id: string;
  kind: ConsentKind;
  legal_text_id: string;
  status: 'given' | 'revoked';
  method: string;
  given_by: string;
  evidence: Record<string, unknown>;
  given_at: string;
  revoked_at: string | null;
}
export interface ConsentSummary {
  student_id: string;
  public_ref: string;
  label: string;
  is_minor: boolean;
  status: string;
  consent_ok: boolean;
  missing: ConsentKind[];
  consents: ConsentRow[];
  guardian_code_open: boolean;
}
export interface LegalText {
  id: string;
  kind: string;
  version: string;
  body_md: string;
  effective_from: string;
}
export interface DeletionRequest {
  id: string;
  student_label: string | null;
  status: string;
  created_at: string;
}
export interface PiiFields {
  display_name?: string;
  school?: string;
  grade?: string;
  guardian_name?: string;
  guardian_relation?: string;
  guardian_contact?: string;
}
export interface GuardianForm {
  guardian_name: string;
  guardian_relation: string;
  confirmed_at: string;
  declarations: number[];
  /** Velinin gördüğü metnin sürümü (docs/hukuk/veli-onay-formu.md `doc_version`); kanıt kaydına yazılır. */
  doc_version: string;
  /** Gösterilen legal_texts satırı biliniyorsa kimliği (anon canlı modda okunamaz → null; README açık madde). */
  legal_text_id: string | null;
}
/** /onay sayfasının gösterdiği sürümlü metin (saklama günleri doldurulmuş). */
export interface GuardianFormText {
  doc_version: string;
  legal_text_id: string | null;
  /** Veli onay formu gövdesi (Markdown; yer tutucular dolu). */
  form_md: string;
  /** Aydınlatma metni (Markdown; yer tutucular dolu). */
  aydinlatma_md: string;
  aydinlatma_version: string;
  /** Gün sayılarının kaynağı: retention_policies satırları ya da derleme anındaki placeholders.json (anon canlı mod). */
  days_source: 'retention_policies' | 'build';
}

// ---------------------------------------------------------------- maliyet ve pilot kapısı
export interface SpendLedgerRow {
  day: string;
  purpose: string;
  provider: string;
  calls: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
}
export interface CheckSpendResult {
  paid_allowed: boolean;
  degraded: boolean;
  day_usd: number;
  month_usd: number;
  daily_cap: number;
  monthly_cap: number;
  state: 'normal' | 'free_only' | 'degraded' | string;
  lesson_month_usd: number;
  lesson_cap: number;
}
export interface PilotMetricRow {
  metric: string;
  period: string;
  value: number | null;
  detail: Record<string, unknown>;
  computed_at: string;
}
export type PilotGateSettings = Record<string, unknown>;
export interface SpendView {
  today: string;
  month: string;
  ledger: SpendLedgerRow[];
  flags: Record<string, unknown>;
  check: CheckSpendResult;
  table_sizes: { table_name: string; total_bytes: number; row_estimate: number | null; day: string }[];
  pool: { approved: number; pending: number; hits: number };
  pilot_metrics: PilotMetricRow[];
  pilot_gate: PilotGateSettings;
}
export type GateVerdict = 'PASS' | 'FAIL' | 'NO_DATA';
export interface GateRow {
  metric: string;
  verdict: GateVerdict;
  required: boolean;
  value: number | null;
  threshold: string;
  n: number | null;
}
export interface GateResult {
  rows: GateRow[];
  gate: 'AÇIK' | 'KAPALI';
  period: string | null;
}

// ---------------------------------------------------------------- öncelik planı (Kalem b)
export interface CourseRow {
  id: string;
  code: string;
  title: string;
  curriculum_id: string | null;
}
export type ExamTerm = 'vize' | 'final' | 'but' | 'deneme' | 'osym' | 'diger';
export const LEGAL_BASES = [
  'öğrenci kendi kopyası',
  'kamuya açık ÖSYM yayını — yalnız istatistik',
  'eğitmenin kendi sınavı',
] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];
export interface ExamSourceRow {
  id: string;
  course_id: string;
  year: number;
  term: ExamTerm;
  instructor_alias: string | null;
  storage_path: string;
  legal_basis: string;
  status: 'uploaded' | 'ocr_done' | 'clustered' | 'failed';
  error: string | null;
  created_at: string;
}
export interface ExamSourceMeta {
  course_id: string;
  year: number;
  term: ExamTerm;
  legal_basis: LegalBasis;
  instructor_alias: string;
}
export interface ExamItemRow {
  id: string;
  source_id: string;
  item_no: number;
  topic: string | null;
  kind: string | null;
  points: number | null;
  skill_id: string | null;
  /** yalnız v_exam_items_full (E/K); gözlemcide yok */
  ocr_text?: string | null;
}

// ---------------------------------------------------------------- gruplar
export interface ChatMember {
  telegram_user_id: number;
  role: string;
  label: string | null;
  mention_handle: string | null;
  joined_at: string;
}
export interface ChatRow {
  chat_id: number;
  kind: 'group' | 'supergroup' | 'private';
  title: string | null;
  bot_is_admin: boolean;
  bot_can_pin: boolean;
  privacy_mode_off_verified: boolean;
  retention_days: number;
  recording_notice_days: number | null;
  group_auto_answer_min: number;
  members: ChatMember[];
}
export interface StaffRow {
  id: string;
  full_name: string;
  role: StaffRole;
  subject: string | null;
  active: boolean;
}

export interface LessonMeta {
  student_ref: string;
  staff_id: string;
  held_at: string;
  duration_min: number;
  video_ref: string;
}

export interface AuditEvent {
  id: number;
  at: string;
  actor_role: string;
  actor_id: string | null;
  action: string;
  table_name: string;
  row_id: string | null;
}

// ---------------------------------------------------------------- arayüz
export interface DataSource {
  readonly mode: 'mock' | 'live';
  /** "Şimdi": mock'ta fixtures dünyasının sabit anı (2026-10-20T09:00:00Z), live'da saat. */
  now(): Date;
  viewer(): Promise<Viewer | null>;

  overview(): Promise<Overview>;
  alerts(): Promise<AlertItem[]>;
  resolveAlert(id: string): Promise<void>;

  lessonAnalyses(): Promise<LessonListItem[]>;
  lessonDetail(id: string): Promise<LessonDetail | null>;
  approveLesson(id: string, decisions: ClaimDecision[]): Promise<number>;
  registerLesson(meta: LessonMeta): Promise<string>;

  botResponses(filter: BotResponseFilter): Promise<BotResponseRow[]>;
  flag(id: number, reason: string): Promise<void>;

  queue(): Promise<QueueRow[]>;
  queueDetail(row: QueueRow): Promise<QueueDetail | null>;
  approveQuestion(id: string, decision: 'approved' | 'rejected' | 'regenerate', note: string | null): Promise<void>;
  peekAnswerKey(id: string): Promise<AnswerKeyPeek>;
  addQuestion(q: NewQuestion): Promise<string>;
  decidePool(id: string, decision: 'approved' | 'rejected'): Promise<void>;
  decideFigure(id: string, decision: 'verified' | 'rejected'): Promise<void>;
  /** Şüpheli yanılgıyı (pending_review) eğitmen onayıyla `open` yapar (§10.3: "3 kanıt ya da eğitmen onayı → open"). */
  confirmMisconception(id: string): Promise<void>;
  /** Yanılgıyı "Çözüldü" kapatır (resolve_misconception); yalnız takipte `improved` gelen kalemler için ikincil eylem. */
  resolveMisconception(id: string, observationId: number): Promise<void>;
  rejectMisconception(id: string, note: string): Promise<void>;
  setCitationRelevance(citationId: string, relevance: 0 | 1 | 2): Promise<void>;
  publishResearch(outputId: string): Promise<void>;

  /** Aktif müfredatın yaprak kazanımları (soru ekleme formu). */
  skills(): Promise<{ id: string; name: string }[]>;
  students(): Promise<StudentListItem[]>;
  student(ref: string): Promise<StudentDetail | null>;
  addNote(note: NoteInput): Promise<string>;
  staff(): Promise<StaffRow[]>;
  assignStudents(staffId: string, studentIds: string[]): Promise<void>;

  consents(ref?: string | null): Promise<ConsentSummary[]>;
  mintGuardianCode(ref: string, channel: 'telegram' | 'web'): Promise<string>;
  /** Veli onay formunun sürümlü metni (giriş gerektirmez). */
  guardianFormText(): Promise<GuardianFormText>;
  redeemGuardianToken(token: string, form: GuardianForm): Promise<boolean>;
  recordStaffConsent(ref: string, kind: ConsentKind, method: 'paper' | 'panel', evidence: Record<string, unknown>): Promise<string>;
  revokeConsent(consentId: string): Promise<void>;
  setMinor(ref: string, isMinor: boolean): Promise<void>;
  legalTexts(): Promise<LegalText[]>;
  deletionRequests(): Promise<DeletionRequest[]>;
  studentFullName(ref: string): Promise<string | null>;
  updateStudentPii(ref: string, fields: PiiFields): Promise<void>;
  auditRecent(limit: number): Promise<AuditEvent[]>;

  spend(): Promise<SpendView>;
  setFlag(key: string, value: unknown): Promise<void>;
  pilotGate(): Promise<GateResult>;

  courses(): Promise<CourseRow[]>;
  priorityPlans(course: string): Promise<PriorityPlanRow[]>;
  approvePriorityPlan(id: string, decision: 'approved' | 'retired'): Promise<void>;
  examSources(courseId: string): Promise<ExamSourceRow[]>;
  examItems(ids: string[]): Promise<ExamItemRow[]>;
  uploadExamSource(file: Blob, meta: ExamSourceMeta): Promise<ExamSourceRow>;

  chats(): Promise<ChatRow[]>;
  updateChat(id: number, fields: { group_auto_answer_min?: number; retention_days?: number }): Promise<void>;
  linkStaffTelegram(staffId: string, tgUserId: number, username: string, handle: string | null): Promise<void>;
  mintStaffCode(staffId: string): Promise<string>;
}
