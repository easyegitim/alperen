// Yerel (hesapsız) veri kaynağı: fixtures/db/dev-seed.json + fixtures/panel/*.json (BLUEPRINT §2.3, §7).
// Sunucudaki kuralların aynısını uygular ki arayüz yerelde de dürüst davransın:
//   can_see_student (koordinatör hepsi; eğitmen ve gözlemci yalnız staff_students), can_edit_student (gözlemci düzenleyemez → OGR-AUTH-002),
//   approve_question 'not_applicable' anahtarda önce peek_answer_key (→ OGR-Q-003), approve_priority_plan tek 'approved', hata kodları §3.9.
// Deterministiktir: aynı fixture + aynı işlem sırası → aynı çıktı (kodlar ve kimlikler sayaçtan türetilir; saat fixture dünyasının sabit anıdır).
import devSeed from '../../../../fixtures/db/dev-seed.json';
import alertsFixture from '../../../../fixtures/panel/alerts.json';
import botResponsesFixture from '../../../../fixtures/panel/bot_responses.json';
import chatsFixture from '../../../../fixtures/panel/chats.json';
import overviewFixture from '../../../../fixtures/panel/overview.json';
import queueFixture from '../../../../fixtures/panel/queue.json';
import { contentHash } from '../content-hash';
import { PanelError } from '../errors';
import { band, initialLabel, usd } from '../format';
import { GUARDIAN_FORM, guardianFormText, type RetentionPolicyRow } from '../legal';
import { ciStatusFromMetrics, evaluatePilotGate } from '../pilot-gate';
import { statusAfterConsentChange } from '../status';
import { assertChatFields, assertExamUpload } from '../validation';
import {
  type AlertItem,
  type AnswerKeyPeek,
  type AuditEvent,
  type BotResponseRow,
  type ChatRow,
  type CheckSpendResult,
  type CitationRow,
  type ClaimDecision,
  type ConsentKind,
  type ConsentRow,
  type ConsentSummary,
  type CourseRow,
  type DataSource,
  type EvidenceItem,
  type ExamItemRow,
  type ExamSourceRow,
  type FigureRow,
  type LegalText,
  type LessonAnalysisRow,
  type LessonClaim,
  type LessonDetail,
  type LessonRow,
  type MasteryRow,
  type MisconceptionRow,
  type PilotMetricRow,
  type PoolRow,
  type PriorityPlanRow,
  type QuestionRow,
  type QueueDetail,
  type QueueRow,
  type SpendLedgerRow,
  type StaffRole,
  type StaffRow,
  type StudentDetail,
  type Viewer,
} from './types';

/** Fixture dünyasının "şimdi"si (fixtures/README.md). */
export const MOCK_NOW = '2026-10-20T09:00:00Z';
/** Yerel veli onay sayfası için hazır web bağlantı kodu (Zeynep Ç. — veli onayı eksik). README'de belgelidir. */
export const MOCK_WEB_TOKEN = 'W4QX-7KD2';

type Json = Record<string, unknown>;
interface SeedStudent { id: string; public_ref: string; is_minor: boolean; tier: string; status: string; deleted_at: string | null }
interface SeedPii { student_id: string; display_name: string | null; school: string | null; grade: string | null; guardian_name: string | null; guardian_relation: string | null; guardian_contact: string | null; birth_year: number | null }
interface SeedIdentity { telegram_user_id: number; student_id: string | null; staff_id: string | null; username: string | null; mention_handle?: string | null }
interface SeedGuardianCode { id: string; student_id: string; code_hash: string; channel: string; expires_at: string; used_at: string | null; attempts: number; locked_until: string | null; code_plain?: string }
interface SeedEnrollment { id: string; student_id: string; curriculum_id: string; period_label: string; status: string; started_at: string }
interface SeedSkill { curriculum_id: string; id: string; parent_id: string | null; name: string; is_leaf: boolean; order_no: number }
interface SeedMastery { enrollment_id: string; skill_id: string; p: number; evidence_count: number; last_evidence_at: string | null }
interface SeedObservation { id: number; enrollment_id: string; skill_id: string; kind: string; value: number; quote: string | null; source_locator: string | null; source_type: string; source_id: string; created_at: string }
interface SeedNote { id: string; enrollment_id: string; author_id: string; skill_id: string | null; body: string; mastery_estimate: number | null; approved_fact: boolean; created_at: string }
interface SeedAttempt { id: number; enrollment_id: string; question_id: string; context: string; is_correct: boolean | null; misconception_tag: string | null; graded_at: string | null; created_at: string }
interface SeedAnswerKey { question_id: string; correct_option: string | null; numeric_value: string | null; solution: string | null; sympy_status: string; written_by: string }
interface SeedMessage { id: number; text_raw: string | null; text_llm: string | null; answered_at: string | null }
interface SeedEscalation { id: string; student_id: string | null; reason: string; status: string; created_at: string; answered_at: string | null; answered_by: string | null }
interface SeedCourse { id: string; code: string; title: string; curriculum_id: string | null }
interface SeedResearchOutput { id: string; status: string; output: Json }
interface SeedSetting { key: string; value: unknown }
interface SeedFlag { key: string; value: unknown; updated_by?: string }
interface SeedMemoryFact { id: number; student_id: string; kind: string; text: string; morale_signal: number | null; source_lesson_claim_id: string | null }
interface SeedCurriculum { id: string; code: string; year: number; status: string }

interface World {
  students: SeedStudent[];
  pii: SeedPii[];
  identities: SeedIdentity[];
  guardianCodes: SeedGuardianCode[];
  staff: StaffRow[];
  staffStudents: { staff_id: string; student_id: string }[];
  consents: ConsentRow[];
  legalTexts: LegalText[];
  retentionPolicies: RetentionPolicyRow[];
  curricula: SeedCurriculum[];
  settings: SeedSetting[];
  flags: SeedFlag[];
  enrollments: SeedEnrollment[];
  skills: SeedSkill[];
  mastery: SeedMastery[];
  observations: SeedObservation[];
  misconceptions: MisconceptionRow[];
  misconceptionEvidence: { misconception_id: string; observation_id: number }[];
  notes: SeedNote[];
  weekly: { student_id: string; week_start: string; body: string; metrics: Json }[];
  quotaUsage: { student_id: string | null; day: string; kind: string; used: number }[];
  quotaLimits: { tier: string; kind: string; daily_limit: number }[];
  attempts: SeedAttempt[];
  questions: QuestionRow[];
  answerKeys: SeedAnswerKey[];
  figures: FigureRow[];
  pool: PoolRow[];
  messages: SeedMessage[];
  escalations: SeedEscalation[];
  memoryFacts: SeedMemoryFact[];
  lessons: LessonRow[];
  analyses: LessonAnalysisRow[];
  claims: LessonClaim[];
  courses: SeedCourse[];
  examSources: ExamSourceRow[];
  examItems: (ExamItemRow & { ocr_text: string | null })[];
  plans: Omit<PriorityPlanRow, 'course_code'>[];
  researchOutputs: SeedResearchOutput[];
  citations: CitationRow[];
  spend: SpendLedgerRow[];
  pilotMetrics: PilotMetricRow[];
  alerts: AlertItem[];
  botResponses: BotResponseRow[];
  chats: ChatRow[];
  queue: QueueRow[];
  generationRequests: Json[];
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function table<T>(name: string): T[] {
  const t = (devSeed as unknown as Record<string, unknown>)[name];
  return Array.isArray(t) ? (clone(t) as T[]) : [];
}

function buildWorld(): World {
  const studentsById = new Map(table<SeedStudent>('students').map((s) => [s.id, s]));
  const refToId = new Map([...studentsById.values()].map((s) => [s.public_ref, s.id]));
  const guardianCodes = table<SeedGuardianCode>('secure.guardian_codes');
  // Yerel web bağlantısı: Zeynep Ç. (veli onayı eksik) için 72 saatlik tek kullanımlık kod
  guardianCodes.push({
    id: '00000000-0000-4000-8000-00000000a001',
    student_id: refToId.get('s_mb5tj7ye4ql2') ?? '',
    code_hash: '',
    code_plain: MOCK_WEB_TOKEN.replace('-', ''),
    channel: 'web',
    expires_at: '2026-10-22T09:00:00Z',
    used_at: null,
    attempts: 0,
    locked_until: null,
  });
  const alerts = (clone(alertsFixture) as unknown as AlertItem[]).map((a) => ({ ...a }));
  const botResponses = (clone(botResponsesFixture) as unknown as (BotResponseRow & { memory_count?: number })[]).map((r) => ({
    ...r,
    in_text: null,
  }));
  return {
    students: [...studentsById.values()],
    pii: table<SeedPii>('secure.student_pii'),
    identities: table<SeedIdentity>('secure.telegram_identities'),
    guardianCodes,
    staff: table<StaffRow>('staff'),
    staffStudents: table('staff_students'),
    consents: table<ConsentRow>('consents'),
    legalTexts: table<LegalText>('legal_texts'),
    retentionPolicies: table<RetentionPolicyRow>('retention_policies'),
    curricula: table<SeedCurriculum>('curricula'),
    settings: table<SeedSetting>('settings'),
    flags: table<SeedFlag>('runtime_flags'),
    enrollments: table<SeedEnrollment>('enrollments'),
    skills: table<SeedSkill>('skills'),
    mastery: table<SeedMastery>('mastery'),
    observations: table<SeedObservation>('observations'),
    misconceptions: table<MisconceptionRow>('misconceptions'),
    misconceptionEvidence: table('misconception_evidence'),
    notes: table<SeedNote>('instructor_notes'),
    weekly: table('weekly_summaries'),
    quotaUsage: table('quota_usage'),
    quotaLimits: table('quota_limits'),
    attempts: table<SeedAttempt>('attempts'),
    questions: table<QuestionRow>('questions'),
    answerKeys: table<SeedAnswerKey>('secure.answer_keys'),
    figures: table<FigureRow>('figures'),
    pool: table<PoolRow>('content_pool'),
    messages: table<SeedMessage>('messages'),
    escalations: table<SeedEscalation>('escalations'),
    memoryFacts: table<SeedMemoryFact>('memory_facts'),
    lessons: table<LessonRow>('lessons'),
    analyses: table<LessonAnalysisRow>('lesson_analyses'),
    claims: table<LessonClaim>('lesson_claims'),
    courses: table<SeedCourse>('courses'),
    examSources: table<ExamSourceRow>('exam_sources'),
    examItems: table('exam_items'),
    plans: table('exam_priority_plans'),
    researchOutputs: table<SeedResearchOutput>('research_outputs'),
    citations: table<CitationRow>('citations'),
    spend: table<SpendLedgerRow>('spend_ledger'),
    pilotMetrics: table<PilotMetricRow>('pilot_metrics'),
    alerts,
    botResponses,
    chats: clone(chatsFixture) as unknown as ChatRow[],
    queue: clone(queueFixture) as unknown as QueueRow[],
    generationRequests: table('generation_requests'),
  };
}

// ------------------------------------------------------------------ deterministik kod ve kimlik üretimi
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
export function deterministicCode(seed: string): string {
  let h = fnv1a(seed);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += B32[h % 32];
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    if (h === 0) h = fnv1a(seed + i);
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}
function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, '');
}

export interface MockOptions {
  role?: StaffRole;
}

export function createMockDataSource(opts: MockOptions = {}): DataSource {
  const role: StaffRole = opts.role ?? 'coordinator';
  const w = buildWorld();
  const me = w.staff.find((s) => s.role === role && s.active);
  if (!me) throw new PanelError('PANEL-NOTFOUND', `fixture'da ${role} yok`);
  const viewer: Viewer = { id: me.id, full_name: me.full_name, role: me.role, subject: me.subject };
  const now = new Date(MOCK_NOW);
  const nowIso = MOCK_NOW;
  let seq = 0;
  const nextId = () => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;
  const audit: AuditEvent[] = [];
  const peeked = new Map<string, number>(); // question_id → zaman (ms)
  let redeemFailures = 0;
  const contentHashes = new Set<string>();

  const logAudit = (action: string, tableName: string, rowId: string | null) => {
    audit.push({ id: audit.length + 1, at: nowIso, actor_role: 'authenticated', actor_id: `staff:${viewer.id}`, action, table_name: tableName, row_id: rowId });
  };

  // ---------------------------------------------------------------- yetki yardımcıları (app.* eşlenikleri)
  const canSee = (sid: string | null | undefined): boolean =>
    !!sid && (viewer.role === 'coordinator' || w.staffStudents.some((l) => l.staff_id === viewer.id && l.student_id === sid));
  const canEdit = (sid: string | null | undefined): boolean => (viewer.role === 'coordinator' || viewer.role === 'instructor') && canSee(sid);
  const requireEdit = (sid: string | null | undefined) => {
    if (!canEdit(sid)) throw new PanelError('OGR-AUTH-002');
  };
  const requireStaffEditor = () => {
    if (viewer.role !== 'coordinator' && viewer.role !== 'instructor') throw new PanelError('OGR-AUTH-002');
  };
  const requireCoordinator = () => {
    if (viewer.role !== 'coordinator') throw new PanelError('OGR-AUTH-002');
  };

  const studentById = (id: string) => w.students.find((s) => s.id === id);
  const studentByRef = (ref: string) => {
    const s = w.students.find((x) => x.public_ref === ref);
    if (!s || !canSee(s.id)) throw new PanelError('OGR-AUTH-002', 'öğrenci görünmüyor');
    return s;
  };
  const labelOf = (sid: string | null | undefined): string | null => {
    if (!sid) return null;
    const s = studentById(sid);
    if (!s) return null;
    const pii = w.pii.find((p) => p.student_id === sid);
    return initialLabel(pii?.display_name, s.public_ref);
  };
  const enrollmentOf = (sid: string) => w.enrollments.find((e) => e.student_id === sid && e.status === 'active');
  const studentOfEnrollment = (eid: string) => w.enrollments.find((e) => e.id === eid)?.student_id ?? null;
  const setting = (key: string): unknown => w.settings.find((s) => s.key === key)?.value;
  const flag = (key: string): unknown => w.flags.find((f) => f.key === key)?.value;
  const minEvidence = () => (typeof setting('min_evidence') === 'number' ? (setting('min_evidence') as number) : 5);
  const skillName = (curriculumId: string, skillId: string) => w.skills.find((s) => s.curriculum_id === curriculumId && s.id === skillId)?.name ?? skillId;

  const masteryView = (eid: string): MasteryRow[] => {
    const enr = w.enrollments.find((e) => e.id === eid);
    if (!enr) return [];
    const min = minEvidence();
    return w.mastery
      .filter((m) => m.enrollment_id === eid)
      .map((m) => ({
        skill_id: m.skill_id,
        skill_name: skillName(enr.curriculum_id, m.skill_id),
        p: m.p,
        evidence_count: m.evidence_count,
        is_reliable: m.evidence_count >= min,
        band: band(m.p),
        last_evidence_at: m.last_evidence_at,
      }))
      .sort((a, b) => a.skill_id.localeCompare(b.skill_id));
  };

  const evidenceOf = (misconceptionId: string): EvidenceItem[] =>
    w.misconceptionEvidence
      .filter((l) => l.misconception_id === misconceptionId)
      .map((l) => w.observations.find((o) => o.id === l.observation_id))
      .filter((o): o is SeedObservation => !!o)
      .map((o) => ({ observation_id: o.id, quote: o.quote, source_locator: o.source_locator, kind: o.kind, created_at: o.created_at }));

  const recomputeStatus = (sid: string) => {
    const s = studentById(sid);
    if (!s) return;
    const given = new Set(w.consents.filter((c) => c.student_id === sid && c.status === 'given').map((c) => c.kind));
    const next = statusAfterConsentChange(s.status, given, s.is_minor);
    if (next) s.status = next;
  };
  /** Aktif müfredat (live activeCurriculum ile aynı: status='active', en yeni yıl). */
  const activeCurriculum = (): string => {
    const c = [...w.curricula].filter((x) => x.status === 'active').sort((a, b) => b.year - a.year)[0];
    if (!c) throw new PanelError('PANEL-NOTFOUND', 'aktif müfredat yok');
    return c.id;
  };

  const latestLegal = (kind: string) =>
    [...w.legalTexts].filter((l) => l.kind === kind).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];

  const upsertConsent = (sid: string, kind: ConsentKind, method: string, givenBy: string, evidence: Json, legalTextId: string | null = null): string => {
    const lt = (legalTextId ? w.legalTexts.find((l) => l.id === legalTextId && l.kind === kind) : undefined) ?? latestLegal(kind);
    let c = w.consents.find((x) => x.student_id === sid && x.kind === kind && x.status === 'given');
    if (c) Object.assign(c, { legal_text_id: lt?.id ?? c.legal_text_id, method, given_by: givenBy, evidence, given_at: nowIso });
    else {
      c = { id: nextId(), student_id: sid, kind, legal_text_id: lt?.id ?? '', status: 'given', method, given_by: givenBy, evidence, given_at: nowIso, revoked_at: null };
      w.consents.push(c);
    }
    recomputeStatus(sid);
    return c.id;
  };

  const dropFromQueue = (kind: QueueRow['kind'], refId: string) => {
    w.queue = w.queue.filter((q) => !(q.kind === kind && q.ref_id === refId));
  };

  const withContext = (r: BotResponseRow): BotResponseRow => {
    const msg = r.in_message_id === null ? undefined : w.messages.find((m) => m.id === r.in_message_id);
    const text = msg ? (viewer.role === 'observer' ? msg.text_llm : (msg.text_raw ?? msg.text_llm)) : null;
    return { ...r, student_label: labelOf(r.student_id) ?? r.student_label, in_text: text ?? null };
  };

  const alertVisible = (a: AlertItem): boolean => {
    if (viewer.role === 'coordinator') return true;
    const sid = a.student_ref ? w.students.find((s) => s.public_ref === a.student_ref)?.id : null;
    if (sid) return canSee(sid);
    return a.staff_ref === viewer.id;
  };

  const questionWithKey = (id: string) => {
    const q = w.questions.find((x) => x.id === id);
    if (!q) throw new PanelError('PANEL-NOTFOUND', 'soru yok');
    return q;
  };

  const ds: DataSource = {
    mode: 'mock',
    now: () => new Date(now),
    viewer: async () => viewer,

    // ---------------------------------------------------------------- genel bakış
    async overview() {
      const open = w.alerts.filter((a) => a.status === 'open' && alertVisible(a));
      const base = clone(overviewFixture) as unknown as { response_series: { day: string; median_hours: number | null }[]; tiles: { response_hours: number | null }; pilot: { metric: string; period: string; value: number | null }[] };
      return {
        tiles: {
          unanswered: open.filter((a) => a.kind === 'unanswered').length,
          silent: open.filter((a) => a.kind === 'silent').length,
          deadlines: open.filter((a) => a.kind === 'deadline').length,
          response_hours: base.tiles.response_hours,
        },
        alerts: open.map((a) => {
          const { id: _id, status: _status, student_label: _label, ...alert } = a;
          return alert;
        }),
        response_series: base.response_series,
        pilot: base.pilot,
      };
    },
    async alerts() {
      return w.alerts.filter((a) => a.status === 'open' && alertVisible(a)).map((a) => ({ ...a }));
    },
    async resolveAlert(id) {
      requireStaffEditor();
      const a = w.alerts.find((x) => x.id === id);
      if (!a) throw new PanelError('OGR-ALERT-001');
      if (!alertVisible(a)) throw new PanelError('OGR-AUTH-002');
      const escId = a.ref.escalation_id;
      if (escId) {
        const e = w.escalations.find((x) => x.id === escId && x.status === 'open');
        if (e) Object.assign(e, { status: 'answered', answered_at: e.answered_at ?? nowIso, answered_by: e.answered_by ?? viewer.id });
      }
      const msgId = a.ref.message_id;
      if (typeof msgId === 'number') {
        const m = w.messages.find((x) => x.id === msgId);
        if (m) m.answered_at = m.answered_at ?? nowIso;
      }
      a.status = 'done';
      logAudit('RPC:resolve_alert', 'instructor_alerts', id);
    },

    // ---------------------------------------------------------------- ders raporları
    async lessonAnalyses() {
      return w.analyses
        .map((a) => {
          const l = w.lessons.find((x) => x.id === a.lesson_id);
          const sid = l ? studentOfEnrollment(l.enrollment_id) : null;
          return { a, l, sid };
        })
        .filter((x) => x.l && canSee(x.sid))
        .map(({ a, l, sid }) => ({
          analysis_id: a.id,
          lesson_id: a.lesson_id,
          held_at: l!.held_at,
          status: a.status,
          student_label: labelOf(sid) ?? '—',
          student_ref: studentById(sid!)?.public_ref ?? '',
          staff_name: w.staff.find((s) => s.id === l!.staff_id)?.full_name ?? null,
          created_at: a.created_at,
        }))
        .sort((x, y) => y.created_at.localeCompare(x.created_at));
    },
    async lessonDetail(id): Promise<LessonDetail | null> {
      const analysis = w.analyses.find((a) => a.id === id) ?? [...w.analyses].filter((a) => a.lesson_id === id).sort((a, b) => b.version - a.version)[0];
      if (!analysis) return null;
      const lesson = w.lessons.find((l) => l.id === analysis.lesson_id);
      if (!lesson) return null;
      const sid = studentOfEnrollment(lesson.enrollment_id);
      if (!canSee(sid)) return null;
      const enr = w.enrollments.find((e) => e.id === lesson.enrollment_id)!;
      return {
        lesson: clone(lesson),
        student_label: labelOf(sid) ?? '—',
        student_ref: studentById(sid!)?.public_ref ?? '',
        staff_name: w.staff.find((s) => s.id === lesson.staff_id)?.full_name ?? null,
        analysis: clone(analysis),
        claims: clone(w.claims.filter((c) => c.analysis_id === analysis.id)).sort((a, b) => a.t_start_sec - b.t_start_sec),
        cost_line: `Ders analizi: ${usd(analysis.cost_usd)} (ayrı bütçe)`,
        skill_names: Object.fromEntries(w.skills.filter((s) => s.curriculum_id === enr.curriculum_id).map((s) => [s.id, s.name])),
        current_mastery: masteryView(enr.id),
        min_evidence: minEvidence(),
      };
    },
    async approveLesson(id, decisions: ClaimDecision[]) {
      const analysis = w.analyses.find((a) => a.id === id);
      if (!analysis) throw new PanelError('PANEL-NOTFOUND', 'rapor yok');
      const lesson = w.lessons.find((l) => l.id === analysis.lesson_id)!;
      const sid = studentOfEnrollment(lesson.enrollment_id);
      requireEdit(sid);
      if (analysis.status !== 'draft') throw new PanelError('OGR-LESSON-001');
      let n = 0;
      let anyEdit = false;
      for (const d of decisions) {
        const c = w.claims.find((x) => x.id === d.claim_id && x.analysis_id === id);
        if (!c) continue;
        Object.assign(c, { status: d.status, edited_value: d.edited_value ?? null, decided_by: viewer.id, decided_at: nowIso });
        if (d.status !== 'approved' && d.status !== 'edited') continue;
        const v = (d.edited_value ?? c.value) as Json;
        anyEdit = anyEdit || d.status === 'edited';
        if (c.kind === 'skill_mastery' || c.kind === 'misconception') {
          w.observations.push({
            id: w.observations.length + 1000,
            enrollment_id: lesson.enrollment_id,
            skill_id: c.skill_id ?? '',
            kind: 'lesson',
            value: c.kind === 'skill_mastery' ? Number(v.mastery ?? 0) : 0,
            quote: c.quote,
            source_locator: `Ders · ${c.t_start_sec} sn`,
            source_type: 'lesson_claim',
            source_id: c.id,
            created_at: nowIso,
          });
          n += 1;
        } else if (c.kind === 'homework' || c.kind === 'promise' || c.kind === 'deadline') {
          w.memoryFacts.push({ id: w.memoryFacts.length + 1000, student_id: sid!, kind: c.kind === 'promise' ? 'promise' : 'deadline', text: String(v.text ?? ''), morale_signal: null, source_lesson_claim_id: c.id });
          n += 1;
        } else if (c.kind === 'talk') {
          const morale = String(v.morale ?? '');
          const signal = morale === 'low' ? -2 : morale === 'medium' ? 0 : morale === 'high' ? 1 : null;
          w.memoryFacts.push({ id: w.memoryFacts.length + 1000, student_id: sid!, kind: 'morale', text: 'Derste moral', morale_signal: signal, source_lesson_claim_id: c.id });
          n += 1;
        }
      }
      analysis.status = anyEdit ? 'corrected' : 'approved';
      analysis.approved_by = viewer.id;
      analysis.approved_at = nowIso;
      lesson.status = anyEdit ? 'corrected' : 'approved';
      dropFromQueue('lesson_analysis', id);
      w.alerts.forEach((a) => {
        if (a.kind === 'ops' && a.ref.lesson_id === lesson.id) a.status = 'done';
      });
      logAudit('RPC:approve_lesson_analysis', 'lesson_analyses', id);
      return n;
    },
    async registerLesson(meta) {
      const s = w.students.find((x) => x.public_ref === meta.student_ref);
      if (!s) throw new PanelError('PANEL-NOTFOUND', 'öğrenci yok');
      requireEdit(s.id);
      const enr = enrollmentOf(s.id);
      if (!enr || !w.staff.some((x) => x.id === meta.staff_id)) throw new PanelError('OGR-LESSON-002');
      if (!meta.video_ref.trim() || !(meta.duration_min > 0)) throw new PanelError('PANEL-FORM');
      const id = nextId();
      w.lessons.push({ id, enrollment_id: enr.id, staff_id: meta.staff_id, held_at: meta.held_at, duration_min: meta.duration_min, video_deleted_at: null, deletion_notified_at: null, transcript_path: null, frames_count: null, status: 'uploaded', created_at: nowIso });
      return id;
    },

    // ---------------------------------------------------------------- bot cevapları
    async botResponses(filter) {
      return w.botResponses
        .filter((r) => r.student_id === null ? viewer.role === 'coordinator' : canSee(r.student_id))
        .filter((r) => !filter.week || r.review_week === filter.week)
        .filter((r) => !filter.flaggedOnly || r.flagged)
        .filter((r) => !filter.studentRef || r.student_ref === filter.studentRef)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(withContext);
    },
    async flag(id, reason) {
      const r = w.botResponses.find((x) => x.id === id);
      if (!r) throw new PanelError('PANEL-NOTFOUND', 'cevap yok');
      requireEdit(r.student_id);
      if (!reason.trim()) throw new PanelError('PANEL-FORM', 'neden boş');
      Object.assign(r, { flagged: true, flag_reason: reason.trim(), flagged_by: viewer.id, flagged_at: nowIso });
      if (!w.queue.some((q) => q.kind === 'flagged_response' && q.ref_id === String(id))) {
        w.queue.push({ kind: 'flagged_response', ref_id: String(id), created_at: nowIso, reason: reason.trim(), student_ref: r.student_ref, staff_hint: viewer.full_name });
      }
    },

    // ---------------------------------------------------------------- kuyruk
    async queue() {
      return w.queue
        .filter((q) => {
          if (!q.student_ref) return true;
          const s = w.students.find((x) => x.public_ref === q.student_ref);
          return !!s && canSee(s.id);
        })
        .map((q) => ({ ...q }))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    async queueDetail(row): Promise<QueueDetail | null> {
      const figUrl = (f: FigureRow | null | undefined) => (f ? `data:image/svg+xml;utf8,${encodeURIComponent(placeholderSvg(f.alt_text))}` : null);
      switch (row.kind) {
        case 'question': {
          const question = w.questions.find((q) => q.id === row.ref_id);
          if (!question) return null;
          const figure = question.figure_id ? (w.figures.find((f) => f.id === question.figure_id) ?? null) : null;
          return { kind: 'question', question: clone(question), figure: clone(figure), figure_url: figUrl(figure) };
        }
        case 'figure': {
          const figure = w.figures.find((f) => f.id === row.ref_id);
          if (!figure) return null;
          return { kind: 'figure', figure: clone(figure), figure_url: figUrl(figure), used_by: clone(w.questions.filter((q) => q.figure_id === figure.id)) };
        }
        case 'misconception': {
          const m = w.misconceptions.find((x) => x.id === row.ref_id);
          if (!m) return null;
          const sid = studentOfEnrollment(m.enrollment_id);
          if (!canSee(sid)) return null;
          return { kind: 'misconception', misconception: clone(m), evidence: evidenceOf(m.id), student_label: labelOf(sid) };
        }
        case 'pool': {
          const pool = w.pool.find((p) => p.id === row.ref_id);
          return pool ? { kind: 'pool', pool: clone(pool) } : null;
        }
        case 'lesson_analysis': {
          const s = row.student_ref ? w.students.find((x) => x.public_ref === row.student_ref) : undefined;
          return { kind: 'lesson_analysis', analysis_id: row.ref_id, student_label: labelOf(s?.id) };
        }
        case 'flagged_response': {
          const r = w.botResponses.find((x) => String(x.id) === row.ref_id);
          return r && (r.student_id === null || canSee(r.student_id)) ? { kind: 'flagged_response', response: withContext(r) } : null;
        }
        case 'priority_plan': {
          const p = w.plans.find((x) => x.id === row.ref_id);
          return p ? { kind: 'priority_plan', plan: { ...clone(p), course_code: w.courses.find((c) => c.id === p.course_id)?.code ?? '' } } : null;
        }
        case 'research': {
          const out = w.researchOutputs.find((o) => o.id === row.ref_id);
          if (!out) return null;
          return {
            kind: 'research',
            research: {
              id: out.id,
              status: out.status as 'pending_review',
              output: clone(out.output) as never,
              citations: clone(w.citations.filter((c) => c.output_id === out.id)).sort((a, b) => a.ordinal - b.ordinal),
            },
          };
        }
        default:
          return null;
      }
    },
    async approveQuestion(id, decision, note) {
      requireStaffEditor();
      const q = questionWithKey(id);
      if (decision === 'approved') {
        const key = w.answerKeys.find((k) => k.question_id === id);
        if (!key || !['verified', 'not_applicable'].includes(key.sympy_status)) throw new PanelError('OGR-Q-001');
        if (q.figure_id && w.figures.find((f) => f.id === q.figure_id)?.review_status !== 'verified') throw new PanelError('OGR-Q-001', 'şekil doğrulanmadı');
        if (key.sympy_status === 'not_applicable') {
          const at = peeked.get(id);
          if (at === undefined || now.getTime() - at > 30 * 60 * 1000) throw new PanelError('OGR-Q-003');
        }
        q.status = 'approved';
      } else if (decision === 'rejected') {
        q.status = 'rejected';
      } else {
        q.status = 'retired';
        w.generationRequests.push({ kind: 'regenerate', skill_id: q.skill_ids[0], question_kind: q.kind, requested_by_staff: viewer.id, needs_generation: true });
      }
      q.review_note = note;
      dropFromQueue('question', id);
      logAudit('RPC:approve_question', 'questions', id);
    },
    async peekAnswerKey(id): Promise<AnswerKeyPeek> {
      requireStaffEditor();
      const key = w.answerKeys.find((k) => k.question_id === id);
      peeked.set(id, now.getTime());
      logAudit('RPC:peek_answer_key', 'questions', id);
      return {
        correct_option: key?.correct_option ?? null,
        numeric_value: key?.numeric_value ?? null,
        solution: key?.solution ?? null,
        sympy_status: key?.sympy_status ?? 'pending',
      };
    },
    async addQuestion(input) {
      requireStaffEditor();
      const keys = input.options.map((o) => o.key);
      if (!input.stem.trim() || input.options.length !== (setting('max_options') as number ?? 4) || !keys.includes(input.correct_option) || input.options.some((o) => !o.text.trim())) {
        throw new PanelError('PANEL-FORM');
      }
      const curriculumId = activeCurriculum();
      if (!w.skills.some((s) => s.curriculum_id === curriculumId && s.id === input.skill_id)) throw new PanelError('PANEL-FORM', 'kazanım yok');
      // content_hash unique (§3.4): aynı kök ve şıklar ikinci kez yazılmaz
      const hash = await contentHash(input.stem, input.options);
      if (contentHashes.has(hash)) throw new PanelError('PANEL-FORM', 'aynı soru zaten var');
      contentHashes.add(hash);
      const id = nextId();
      w.questions.push({ id, curriculum_id: curriculumId, skill_ids: [input.skill_id], kind: 'mcq', stem: input.stem.trim(), figure_id: null, options: input.options, difficulty: input.difficulty, source: 'instructor', verification: { schema: true, sympy: 'not_applicable', render: 'not_applicable', vision: 'not_applicable', attempts: 0 }, status: 'pending_review', model: null, review_note: null, created_at: nowIso });
      w.answerKeys.push({ question_id: id, correct_option: input.correct_option, numeric_value: null, solution: input.solution, sympy_status: 'not_applicable', written_by: `staff:${viewer.id}` });
      // set_answer_key, approve_question için "anahtar görüldü" kanıtıdır (§3.9)
      peeked.set(id, now.getTime());
      logAudit('RPC:set_answer_key', 'questions', id);
      w.queue.push({ kind: 'question', ref_id: id, created_at: nowIso, reason: 'Eğitmen sorusu onay bekliyor', student_ref: null, staff_hint: 'instructor' });
      return id;
    },
    async decidePool(id, decision) {
      requireStaffEditor();
      const p = w.pool.find((x) => x.id === id);
      if (!p) throw new PanelError('PANEL-NOTFOUND');
      p.status = decision;
      dropFromQueue('pool', id);
    },
    async decideFigure(id, decision) {
      requireStaffEditor();
      // §3.4: review_status in ('pending','verified','rejected') — başka değer check kısıtına takılır
      if (decision !== 'verified' && decision !== 'rejected') throw new PanelError('PANEL-FORM', 'karar verified|rejected');
      const f = w.figures.find((x) => x.id === id);
      if (!f) throw new PanelError('PANEL-NOTFOUND');
      f.review_status = decision;
      dropFromQueue('figure', id);
      logAudit('UPDATE', 'figures', id);
    },
    async confirmMisconception(id) {
      const m = w.misconceptions.find((x) => x.id === id);
      if (!m) throw new PanelError('PANEL-NOTFOUND');
      requireEdit(studentOfEnrollment(m.enrollment_id));
      // live ile aynı: update … set status='open' where id=… and status='pending_review' (0 satır → bulunamadı)
      if (m.status !== 'pending_review') throw new PanelError('PANEL-NOTFOUND', 'yanılgı onay beklemiyor');
      m.status = 'open';
      dropFromQueue('misconception', id);
      logAudit('UPDATE', 'misconceptions', id);
    },
    async resolveMisconception(id, observationId) {
      const m = w.misconceptions.find((x) => x.id === id);
      if (!m) throw new PanelError('PANEL-NOTFOUND');
      requireEdit(studentOfEnrollment(m.enrollment_id));
      if (!w.misconceptionEvidence.some((l) => l.misconception_id === id && l.observation_id === observationId)) throw new PanelError('PANEL-FORM', 'kanıt yok');
      Object.assign(m, { status: 'resolved', resolved_at: nowIso });
      dropFromQueue('misconception', id);
    },
    async rejectMisconception(id, note) {
      const m = w.misconceptions.find((x) => x.id === id);
      if (!m) throw new PanelError('PANEL-NOTFOUND');
      requireEdit(studentOfEnrollment(m.enrollment_id));
      if (!note.trim()) throw new PanelError('PANEL-FORM', 'not boş');
      m.status = 'rejected';
      dropFromQueue('misconception', id);
    },
    async setCitationRelevance(citationId, relevance) {
      requireStaffEditor();
      const c = w.citations.find((x) => x.id === citationId);
      if (!c || ![0, 1, 2].includes(relevance)) throw new PanelError('PANEL-FORM');
      c.relevance = relevance;
    },
    async publishResearch(outputId) {
      requireStaffEditor();
      const o = w.researchOutputs.find((x) => x.id === outputId);
      if (!o) throw new PanelError('PANEL-NOTFOUND');
      o.status = 'released';
      dropFromQueue('research', outputId);
    },

    // ---------------------------------------------------------------- öğrenciler
    async skills() {
      const cur = activeCurriculum();
      return w.skills.filter((k) => k.curriculum_id === cur && k.is_leaf).sort((a, b) => a.order_no - b.order_no).map((k) => ({ id: k.id, name: k.name }));
    },
    async students() {
      return w.students
        .filter((s) => s.status !== 'deleted' && canSee(s.id))
        .map((s) => {
          const given = new Set(w.consents.filter((c) => c.student_id === s.id && c.status === 'given').map((c) => c.kind));
          return {
            student_id: s.id,
            public_ref: s.public_ref,
            label: labelOf(s.id) ?? s.public_ref,
            status: s.status,
            is_minor: s.is_minor,
            tier: s.tier,
            consent_ok: given.has('kvkk_aydinlatma') && (!s.is_minor || given.has('veli_onayi')),
            assigned_staff: w.staffStudents.filter((l) => l.student_id === s.id).map((l) => l.staff_id),
          };
        });
    },
    async student(ref): Promise<StudentDetail | null> {
      const s = w.students.find((x) => x.public_ref === ref);
      if (!s || !canSee(s.id)) return null;
      const enr = enrollmentOf(s.id);
      if (!enr) return null;
      const usage = w.quotaUsage.filter((u) => u.student_id === s.id);
      const lastDay = usage.reduce<string | null>((acc, u) => (acc === null || u.day > acc ? u.day : acc), null);
      const limits = w.quotaLimits.filter((l) => l.tier === s.tier && l.daily_limit > 0);
      return {
        student_id: s.id,
        public_ref: s.public_ref,
        label: labelOf(s.id) ?? s.public_ref,
        status: s.status,
        is_minor: s.is_minor,
        tier: s.tier,
        enrollment_id: enr.id,
        curriculum_id: enr.curriculum_id,
        period: enr.period_label,
        min_evidence: minEvidence(),
        mastery: masteryView(enr.id),
        open_misconceptions: w.misconceptions.filter((m) => m.enrollment_id === enr.id && m.status === 'open').map((m) => ({ ...clone(m), evidence: evidenceOf(m.id) })),
        weekly_summary: clone(w.weekly.filter((x) => x.student_id === s.id).sort((a, b) => b.week_start.localeCompare(a.week_start))[0] ?? null),
        quota: limits.map((l) => ({ day: lastDay ?? nowIso.slice(0, 10), kind: l.kind, daily_limit: l.daily_limit, used: usage.find((u) => u.day === lastDay && u.kind === l.kind)?.used ?? 0 })),
        recent_attempts: w.attempts
          .filter((a) => a.enrollment_id === enr.id)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 10)
          .map((a) => ({ id: a.id, question_id: a.question_id, stem: w.questions.find((q) => q.id === a.question_id)?.stem ?? null, context: a.context, is_correct: a.is_correct, misconception_tag: a.misconception_tag, graded_at: a.graded_at })),
        notes: w.notes
          .filter((n) => n.enrollment_id === enr.id)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((n) => ({ id: n.id, body: n.body, skill_id: n.skill_id, author: w.staff.find((x) => x.id === n.author_id)?.full_name ?? null, created_at: n.created_at })),
        skills: w.skills.filter((k) => k.curriculum_id === enr.curriculum_id && k.is_leaf).sort((a, b) => a.order_no - b.order_no).map((k) => ({ id: k.id, name: k.name })),
      };
    },
    async addNote(note) {
      const sid = studentOfEnrollment(note.enrollment_id);
      requireEdit(sid);
      if (!note.body.trim()) throw new PanelError('PANEL-FORM', 'not boş');
      if (note.mastery_estimate !== null && !(note.mastery_estimate >= 0 && note.mastery_estimate <= 1)) throw new PanelError('PANEL-FORM');
      const id = nextId();
      w.notes.push({ id, enrollment_id: note.enrollment_id, author_id: viewer.id, skill_id: note.skill_id, body: note.body.trim(), mastery_estimate: note.mastery_estimate, approved_fact: note.approved_fact, created_at: nowIso });
      if (note.mastery_estimate !== null && note.skill_id) {
        w.observations.push({ id: w.observations.length + 2000, enrollment_id: note.enrollment_id, skill_id: note.skill_id, kind: 'instructor', value: note.mastery_estimate, quote: note.body.trim(), source_locator: 'Eğitmen notu', source_type: 'instructor_note', source_id: id, created_at: nowIso });
      }
      return id;
    },
    async staff() {
      const rows = viewer.role === 'coordinator' ? w.staff : w.staff.filter((s) => s.id === viewer.id || (viewer.role === 'instructor' && s.subject !== null && s.subject === viewer.subject));
      return clone(rows).sort((a, b) => a.full_name.localeCompare(b.full_name, 'tr'));
    },
    async assignStudents(staffId, studentIds) {
      requireCoordinator();
      if (!w.staff.some((s) => s.id === staffId)) throw new PanelError('OGR-STAFF-001');
      w.staffStudents = w.staffStudents.filter((l) => l.staff_id !== staffId).concat(studentIds.map((student_id) => ({ staff_id: staffId, student_id })));
      logAudit('UPDATE', 'staff_students', staffId);
    },

    // ---------------------------------------------------------------- onaylar
    async consents(ref): Promise<ConsentSummary[]> {
      return w.students
        .filter((s) => s.status !== 'deleted' && canSee(s.id) && (!ref || s.public_ref === ref))
        .map((s) => {
          const mine = w.consents.filter((c) => c.student_id === s.id);
          const given = new Set(mine.filter((c) => c.status === 'given').map((c) => c.kind));
          const missing: ConsentKind[] = [];
          if (!given.has('kvkk_aydinlatma')) missing.push('kvkk_aydinlatma');
          if (s.is_minor && !given.has('veli_onayi')) missing.push('veli_onayi');
          return {
            student_id: s.id,
            public_ref: s.public_ref,
            label: labelOf(s.id) ?? s.public_ref,
            is_minor: s.is_minor,
            status: s.status,
            consent_ok: missing.length === 0,
            missing,
            consents: clone(mine),
            guardian_code_open: w.guardianCodes.some((g) => g.student_id === s.id && g.used_at === null && g.expires_at > nowIso && g.channel === 'telegram'),
          };
        });
    },
    async mintGuardianCode(ref, channel) {
      const s = studentByRef(ref);
      requireEdit(s.id);
      if (channel !== 'telegram' && channel !== 'web') throw new PanelError('PANEL-FORM');
      const code = deterministicCode(`guardian:${s.id}:${channel}:${w.guardianCodes.length}`);
      w.guardianCodes.push({ id: nextId(), student_id: s.id, code_hash: '', code_plain: normalizeCode(code), channel, expires_at: new Date(now.getTime() + 72 * 3600 * 1000).toISOString(), used_at: null, attempts: 0, locked_until: null });
      logAudit('RPC:mint_guardian_code', 'students', s.id);
      // RPC gibi tiresiz 8 karakter döner (§3.9 upper(app.base32_random(8))); 'K7F3-2QX9' biçimi panelde formatCode ile
      return normalizeCode(code);
    },
    async redeemGuardianToken(token, form) {
      const decl = new Set(form.declarations);
      if (!form.guardian_name.trim() || !form.guardian_relation.trim() || ![1, 2, 4].every((d) => decl.has(d)) || !form.doc_version) throw new PanelError('PANEL-FORM');
      if (redeemFailures >= 5) throw new PanelError('PANEL-LINK', 'çok sayıda hatalı deneme; bir saat sonra tekrar dene');
      const norm = normalizeCode(token);
      const gc = w.guardianCodes.find((g) => g.channel === 'web' && g.code_plain === norm && g.used_at === null && g.expires_at > nowIso);
      if (!gc) {
        redeemFailures += 1;
        return false;
      }
      gc.used_at = nowIso;
      const pii = w.pii.find((p) => p.student_id === gc.student_id);
      if (pii) Object.assign(pii, { guardian_name: form.guardian_name.trim(), guardian_relation: form.guardian_relation.trim() });
      upsertConsent(
        gc.student_id,
        'veli_onayi',
        'web_token',
        'guardian',
        { token_id: gc.id, confirmed_at: form.confirmed_at, declarations: [...decl].sort(), doc_version: form.doc_version, legal_text_id: form.legal_text_id },
        form.legal_text_id,
      );
      return true;
    },
    async guardianFormText() {
      const lt = w.legalTexts.find((l) => l.kind === 'veli_onayi' && l.version === GUARDIAN_FORM.doc_version);
      return guardianFormText(w.retentionPolicies, null, lt?.id ?? null);
    },
    async recordStaffConsent(ref, kind, method, evidence) {
      const s = studentByRef(ref);
      requireEdit(s.id);
      if (method !== 'paper' && method !== 'panel') throw new PanelError('OGR-CONS-004');
      if (!['kvkk_aydinlatma', 'veli_onayi', 'grup_kayit', 'ders_kaydi'].includes(kind)) throw new PanelError('OGR-CONS-001');
      const id = upsertConsent(s.id, kind, method, `staff:${viewer.id}`, evidence);
      logAudit('RPC:record_staff_consent', 'consents', s.id);
      return id;
    },
    async revokeConsent(consentId) {
      requireCoordinator();
      const c = w.consents.find((x) => x.id === consentId);
      if (!c) throw new PanelError('PANEL-NOTFOUND');
      Object.assign(c, { status: 'revoked', revoked_at: nowIso });
      recomputeStatus(c.student_id);
      logAudit('UPDATE', 'consents', consentId);
    },
    async setMinor(ref, isMinor) {
      requireCoordinator();
      const s = studentByRef(ref);
      s.is_minor = isMinor;
      recomputeStatus(s.id);
    },
    async legalTexts() {
      return clone(w.legalTexts).sort((a, b) => a.kind.localeCompare(b.kind) || b.effective_from.localeCompare(a.effective_from));
    },
    async deletionRequests() {
      return w.escalations
        .filter((e) => e.reason === 'deletion_request' && (viewer.role === 'coordinator' || canSee(e.student_id)))
        .map((e) => ({ id: e.id, status: e.status, created_at: e.created_at, student_label: labelOf(e.student_id) }));
    },
    async studentFullName(ref) {
      requireCoordinator();
      const s = studentByRef(ref);
      logAudit('RPC:student_full_name', 'students', s.id);
      return w.pii.find((p) => p.student_id === s.id)?.display_name ?? null;
    },
    async updateStudentPii(ref, fields) {
      const s = studentByRef(ref);
      requireEdit(s.id);
      const allowed = ['display_name', 'school', 'grade', 'guardian_name', 'guardian_relation', 'guardian_contact'];
      for (const k of Object.keys(fields)) if (!allowed.includes(k)) throw new PanelError('OGR-PII-001', k);
      const pii = w.pii.find((p) => p.student_id === s.id);
      if (pii) {
        for (const [k, v] of Object.entries(fields)) if (typeof v === 'string' && v.trim()) (pii as unknown as Json)[k] = v.trim();
      }
      // audit yalnız alan ADLARINI yazar (değer yok)
      logAudit('RPC:update_student_pii', 'students', s.id);
    },
    async auditRecent(limit) {
      requireCoordinator();
      return [...audit].reverse().slice(0, limit);
    },

    // ---------------------------------------------------------------- maliyet ve pilot kapısı
    async spend() {
      const today = new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
      const month = today.slice(0, 7);
      const excluded = (flag('cap_excluded_purposes') as string[] | undefined) ?? [];
      const ledger = clone(w.spend.filter((r) => r.day.startsWith(month))).sort((a, b) => a.day.localeCompare(b.day) || a.purpose.localeCompare(b.purpose));
      const sum = (rows: SpendLedgerRow[]) => rows.reduce((acc, r) => acc + Number(r.cost_usd), 0);
      const chatRows = ledger.filter((r) => !excluded.includes(r.purpose));
      const lessonRows = ledger.filter((r) => excluded.includes(r.purpose));
      const dayUsd = sum(chatRows.filter((r) => r.day === today));
      const monthUsd = sum(chatRows);
      const dailyCap = Number(flag('daily_cap_usd') ?? 0);
      const monthlyCap = Number(flag('monthly_cap_usd') ?? 0);
      const lessonCap = Number(flag('lesson_monthly_cap_usd') ?? 0);
      const degraded = flag('degraded_mode') === true;
      const paidOn = flag('paid_llm_enabled') !== false;
      const capped = (dailyCap > 0 && dayUsd >= dailyCap) || (monthlyCap > 0 && monthUsd >= monthlyCap);
      const check: CheckSpendResult = {
        // §3.9 check_spend: paid_allowed = v_paid and v_d < v_dc and v_m < v_mc — degraded_mode yalnız `state`i etkiler
        paid_allowed: paidOn && !capped,
        degraded,
        day_usd: dayUsd,
        month_usd: monthUsd,
        daily_cap: dailyCap,
        monthly_cap: monthlyCap,
        state: degraded ? 'degraded' : !paidOn || capped ? 'free_only' : 'normal',
        lesson_month_usd: sum(lessonRows),
        lesson_cap: lessonCap,
      };
      return {
        today,
        month,
        ledger,
        flags: Object.fromEntries(w.flags.map((f) => [f.key, clone(f.value)])),
        check,
        table_sizes: [],
        pool: {
          approved: w.pool.filter((p) => p.status === 'approved').length,
          pending: w.pool.filter((p) => p.status === 'pending_review').length,
          hits: w.pool.reduce((acc, p) => acc + p.hit_count, 0),
        },
        pilot_metrics: clone(w.pilotMetrics),
        pilot_gate: clone((setting('pilot_gate') as Json) ?? {}),
      };
    },
    async setFlag(key, value) {
      requireCoordinator();
      const f = w.flags.find((x) => x.key === key);
      if (f) Object.assign(f, { value: clone(value), updated_by: `authenticated:${viewer.id}` });
      else w.flags.push({ key, value: clone(value), updated_by: `authenticated:${viewer.id}` });
      logAudit('RPC:set_runtime_flag', 'runtime_flags', key);
    },
    async pilotGate() {
      return evaluatePilotGate((setting('pilot_gate') as Json) ?? {}, w.pilotMetrics, ciStatusFromMetrics(w.pilotMetrics));
    },

    // ---------------------------------------------------------------- öncelik planı
    async courses(): Promise<CourseRow[]> {
      return clone(w.courses);
    },
    async priorityPlans(course) {
      const c = w.courses.find((x) => x.code === course || x.id === course);
      if (!c) return [];
      return clone(w.plans.filter((p) => p.course_id === c.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((p) => ({ ...p, course_code: c.code }));
    },
    async approvePriorityPlan(id, decision) {
      requireStaffEditor();
      if (decision !== 'approved' && decision !== 'retired') throw new PanelError('OGR-PLAN-001');
      const p = w.plans.find((x) => x.id === id);
      if (!p) throw new PanelError('OGR-PLAN-002');
      if (decision === 'approved') {
        for (const o of w.plans) if (o.id !== id && o.course_id === p.course_id && o.period === p.period && o.status === 'approved') o.status = 'retired';
        Object.assign(p, { status: 'approved', approved_by: viewer.id, approved_at: nowIso });
      } else p.status = 'retired';
      dropFromQueue('priority_plan', id);
      logAudit('RPC:approve_priority_plan', 'exam_priority_plans', id);
    },
    async examSources(courseId) {
      return clone(w.examSources.filter((s) => s.course_id === courseId)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async examItems(ids) {
      const rows = w.examItems.filter((i) => ids.includes(i.id)).sort((a, b) => a.source_id.localeCompare(b.source_id) || a.item_no - b.item_no);
      // gözlemci ocr_text göremez (v_exam_items_full gözlemciye 0 satır; exam_items'ta sütun yetkisi yok)
      return rows.map(({ ocr_text, ...rest }) => (viewer.role === 'observer' ? { ...rest } : { ...rest, ocr_text }));
    },
    async uploadExamSource(file, meta) {
      requireStaffEditor();
      assertExamUpload(file, meta);
      if (!w.courses.some((c) => c.id === meta.course_id)) throw new PanelError('PANEL-FORM', 'kurs');
      const id = nextId();
      const row: ExamSourceRow = { id, course_id: meta.course_id, year: meta.year, term: meta.term, instructor_alias: meta.instructor_alias, storage_path: `exams/${id}.pdf`, legal_basis: meta.legal_basis, status: 'uploaded', error: null, created_at: nowIso };
      w.examSources.push(row);
      return clone(row);
    },

    // ---------------------------------------------------------------- gruplar
    async chats() {
      const rows = viewer.role === 'instructor'
        ? w.chats.filter((c) => c.members.some((m) => w.identities.some((i) => i.staff_id === viewer.id && i.telegram_user_id === m.telegram_user_id)))
        : w.chats;
      return clone(rows);
    },
    async updateChat(id, fields) {
      requireCoordinator();
      const c = w.chats.find((x) => x.chat_id === id);
      if (!c) throw new PanelError('PANEL-NOTFOUND');
      assertChatFields(fields);
      if (fields.group_auto_answer_min !== undefined) c.group_auto_answer_min = fields.group_auto_answer_min;
      if (fields.retention_days !== undefined) c.retention_days = fields.retention_days;
      logAudit('UPDATE', 'tg_chats', String(id));
    },
    async linkStaffTelegram(staffId, tgUserId, username, handle) {
      requireCoordinator();
      const s = w.staff.find((x) => x.id === staffId && x.active);
      if (!s) throw new PanelError('OGR-STAFF-001');
      if (!Number.isInteger(tgUserId) || tgUserId <= 0 || !username.trim()) throw new PanelError('PANEL-FORM');
      if (w.identities.some((i) => i.telegram_user_id === tgUserId && i.student_id)) throw new PanelError('OGR-STAFF-002');
      const mention = handle?.trim() || `@${username.replace(/^@/, '')}`;
      const existing = w.identities.find((i) => i.telegram_user_id === tgUserId);
      if (existing) Object.assign(existing, { staff_id: staffId, username, mention_handle: mention });
      else w.identities.push({ telegram_user_id: tgUserId, student_id: null, staff_id: staffId, username, mention_handle: mention });
      for (const c of w.chats) for (const m of c.members) if (m.telegram_user_id === tgUserId) Object.assign(m, { role: s.role, label: s.full_name, mention_handle: mention });
      logAudit('RPC:link_staff_telegram', 'staff', staffId);
    },
    async mintStaffCode(staffId) {
      requireCoordinator();
      if (!w.staff.some((x) => x.id === staffId && x.active)) throw new PanelError('OGR-STAFF-001');
      logAudit('RPC:mint_staff_code', 'staff', staffId);
      return normalizeCode(deterministicCode(`staff:${staffId}:${audit.length}`));
    },
  };
  return ds;
}

/** Mock modunda şekil PNG'si Storage'da değildir; alt metni taşıyan, paper zeminli bir yer tutucu çizilir. */
function placeholderSvg(alt: string): string {
  const esc = alt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 90);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400"><rect width="800" height="400" fill="#f6f8fc"/><rect x="8" y="8" width="784" height="384" fill="none" stroke="#051c60" stroke-width="2"/><text x="400" y="190" font-family="sans-serif" font-size="22" fill="#051c60" text-anchor="middle">Yerel veri: şekil dosyası Storage'da</text><text x="400" y="230" font-family="sans-serif" font-size="16" fill="#051c60" text-anchor="middle">${esc}</text></svg>`;
}
