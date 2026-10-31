// Canlı veri kaynağı: PostgREST + RPC, her okuma RLS altında (BLUEPRINT §3.8, §7).
// Kurallar: ham metin (text_raw, ocr_text) YALNIZ v_messages_staff / v_exam_items_full görünümlerinden okunur;
// `messages` ve `exam_items` tablolarından bu sütunlar seçilmez (statik test test/static.test.ts).
// Çağrılan RPC adları test/rpc-names.json ile birebir aynıdır (M13 check-rpc-parity.sh).
import { contentHash } from '../content-hash';
import { PanelError } from '../errors';
import { band as bandOf, usd } from '../format';
import { guardianFormText } from '../legal';
import { ciStatusFromMetrics, evaluatePilotGate } from '../pilot-gate';
import { statusAfterConsentChange } from '../status';
import { assertChatFields, assertExamUpload } from '../validation';
import type { SupabaseClient } from '../supabase';
import type {
  AlertItem,
  AnswerKeyPeek,
  AttemptRow,
  AuditEvent,
  BotResponseFilter,
  BotResponseRow,
  ChatMember,
  ChatRow,
  CheckSpendResult,
  CitationRow,
  ClaimDecision,
  ConsentKind,
  ConsentRow,
  ConsentSummary,
  CourseRow,
  DataSource,
  DeletionRequest,
  EvidenceItem,
  ExamItemRow,
  ExamSourceMeta,
  ExamSourceRow,
  FigureRow,
  GateResult,
  GuardianForm,
  LegalText,
  LessonAnalysisRow,
  LessonClaim,
  LessonDetail,
  LessonListItem,
  LessonMeta,
  LessonRow,
  MasteryRow,
  MisconceptionRow,
  NewQuestion,
  NoteInput,
  Overview,
  PiiFields,
  PilotMetricRow,
  PoolRow,
  PriorityPlanRow,
  QuestionRow,
  QueueDetail,
  QueueRow,
  SpendLedgerRow,
  SpendView,
  StaffRow,
  StudentDetail,
  StudentListItem,
  Viewer,
} from './types';

type Row = Record<string, unknown>;
type StudentBase = { id: string; public_ref: string; status: string; is_minor: boolean; tier: string };

const BOT_RESPONSE_COLS =
  'id,in_message_id,chat_id,student_id,purpose,mode,prompt_version,prompt_text,response_text,memory_fact_ids,provider,model,provider_attempts,cost_usd,confidence,escalated,schema_valid,degraded_mode,flagged,flagged_by,flag_reason,flagged_at,review_week,created_at';

function istanbulDay(d: Date): string {
  return new Date(d.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export function createLiveDataSource(db: SupabaseClient): DataSource {
  let viewerCache: Viewer | null | undefined;

  async function viewer(): Promise<Viewer | null> {
    if (viewerCache !== undefined) return viewerCache;
    const session = await db.auth.getSession();
    if (!session) return null;
    const row = await db.from<Viewer>('staff').select('id,full_name,role,subject').eq('id', session.user.id).eq('active', true).maybeSingle();
    viewerCache = row;
    return row;
  }

  async function requireViewer(): Promise<Viewer> {
    const v = await viewer();
    if (!v) throw new PanelError('OGR-AUTH-002');
    return v;
  }

  async function labels(ids: readonly (string | null | undefined)[]): Promise<Map<string, { label: string; public_ref: string }>> {
    const uniq = [...new Set(ids.filter((x): x is string => typeof x === 'string'))];
    const out = new Map<string, { label: string; public_ref: string }>();
    if (uniq.length === 0) return out;
    const rows = await db.rpc<{ student_id: string; label: string; public_ref: string }[]>('person_labels', { p_student_ids: uniq });
    for (const r of rows ?? []) out.set(r.student_id, { label: r.label, public_ref: r.public_ref });
    return out;
  }

  async function studentByRef(ref: string): Promise<StudentBase> {
    const s = await db.from<StudentBase>('students').select('id,public_ref,status,is_minor,tier').eq('public_ref', ref).maybeSingle();
    if (!s) throw new PanelError('OGR-AUTH-002', 'öğrenci görünmüyor');
    return s;
  }

  async function staffNames(ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => typeof x === 'string'))];
    if (uniq.length === 0) return new Map();
    const rows = await db.from<{ id: string; full_name: string }>('staff').select('id,full_name').in('id', uniq);
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }

  async function settingNumber(key: string, fallback: number): Promise<number> {
    const row = await db.from<{ value: unknown }>('settings').select('value').eq('key', key).maybeSingle();
    return typeof row?.value === 'number' ? row.value : fallback;
  }

  async function inMessages(ids: number[], role: Viewer['role']): Promise<Map<number, string | null>> {
    if (ids.length === 0) return new Map();
    if (role === 'observer') {
      const rows = await db.from<{ id: number; text_llm: string | null }>('messages').select('id,text_llm').in('id', ids);
      return new Map(rows.map((r) => [r.id, r.text_llm]));
    }
    const rows = await db.from<{ id: number; text_raw: string | null; text_llm: string | null }>('v_messages_staff').select('id,text_raw,text_llm').in('id', ids);
    return new Map(rows.map((r) => [r.id, r.text_raw ?? r.text_llm]));
  }

  async function withBotContext(rows: Row[]): Promise<BotResponseRow[]> {
    const v = await requireViewer();
    const lab = await labels(rows.map((r) => r.student_id as string | null));
    const msgs = await inMessages(
      rows.map((r) => r.in_message_id).filter((x): x is number => typeof x === 'number'),
      v.role,
    );
    return rows.map((r) => {
      const l = r.student_id ? lab.get(r.student_id as string) : undefined;
      return {
        ...(r as unknown as BotResponseRow),
        cost_usd: Number(r.cost_usd ?? 0),
        student_label: l?.label ?? null,
        student_ref: l?.public_ref ?? null,
        in_text: typeof r.in_message_id === 'number' ? (msgs.get(r.in_message_id) ?? null) : null,
      };
    });
  }

  async function evidenceFor(misconceptionIds: string[]): Promise<Map<string, EvidenceItem[]>> {
    const out = new Map<string, EvidenceItem[]>();
    if (misconceptionIds.length === 0) return out;
    const links = await db.from<{ misconception_id: string; observation_id: number }>('misconception_evidence').select('misconception_id,observation_id').in('misconception_id', misconceptionIds);
    const obsIds = links.map((l) => l.observation_id);
    const obs = obsIds.length
      ? await db.from<EvidenceItem & { id: number }>('observations').select('id,quote,source_locator,kind,created_at').in('id', obsIds)
      : [];
    const byId = new Map(obs.map((o) => [o.id, o]));
    for (const l of links) {
      const o = byId.get(l.observation_id);
      if (!o) continue;
      const list = out.get(l.misconception_id) ?? [];
      list.push({ observation_id: o.id, quote: o.quote, source_locator: o.source_locator, kind: o.kind, created_at: o.created_at });
      out.set(l.misconception_id, list);
    }
    return out;
  }

  /**
   * Koordinatörün onay iptali / is_minor düzeltmesinden sonra students.status'u RPC'lerle aynı kuralla yazar
   * (§3.9 `case when consent_ok(sid) then 'active' else 'pending_consent' end`; §3.8 K: students u `status`).
   * Mock aynı yardımcıyı (lib/status.ts) kullanır; iki mod aynı sonucu verir.
   */
  async function recomputeStudentStatus(studentId: string): Promise<void> {
    const s = await db.from<StudentBase>('students').select('id,public_ref,status,is_minor,tier').eq('id', studentId).maybeSingle();
    if (!s) return;
    const given = await db.from<{ kind: string }>('consents').select('kind').eq('student_id', studentId).eq('status', 'given');
    const next = statusAfterConsentChange(s.status, new Set(given.map((g) => g.kind)), s.is_minor);
    if (next && next !== s.status) await db.from('students').update({ status: next }).eq('id', studentId);
  }

  function figureUrl(f: FigureRow | null): string | null {
    return f?.png_path ? db.publicObjectUrl('figures', f.png_path.replace(/^figures\//, '')) : null;
  }

  async function activeCurriculum(): Promise<string> {
    const c = await db.from<{ id: string }>('curricula').select('id').eq('status', 'active').order('year', { ascending: false }).limit(1).maybeSingle();
    if (!c) throw new PanelError('PANEL-FORM', 'aktif müfredat yok');
    return c.id;
  }

  async function plansWithCourse(rows: Row[]): Promise<PriorityPlanRow[]> {
    const courseIds = [...new Set(rows.map((r) => r.course_id as string))];
    const courses = courseIds.length ? await db.from<{ id: string; code: string }>('courses').select('id,code').in('id', courseIds) : [];
    const codes = new Map(courses.map((c) => [c.id, c.code]));
    return rows.map((r) => ({ ...(r as unknown as PriorityPlanRow), course_code: codes.get(r.course_id as string) ?? '' }));
  }

  const ds: DataSource = {
    mode: 'live',
    now: () => new Date(),
    viewer,

    // ---------------------------------------------------------------- genel bakış
    async overview(): Promise<Overview> {
      return db.rpc<Overview>('panel_overview');
    },
    async alerts(): Promise<AlertItem[]> {
      const rows = await db
        .from<Row>('instructor_alerts')
        .select('id,kind,severity,student_id,staff_id,detail,since,ref,status,created_at')
        .eq('status', 'open');
      const lab = await labels(rows.map((r) => r.student_id as string | null));
      return rows.map((r) => {
        const l = r.student_id ? lab.get(r.student_id as string) : undefined;
        return {
          schema_version: '1.0',
          id: r.id as string,
          kind: r.kind as AlertItem['kind'],
          severity: r.severity as AlertItem['severity'],
          student_ref: l?.public_ref ?? null,
          staff_ref: (r.staff_id as string | null) ?? null,
          detail: r.detail as string,
          since: (r.since as string | null) ?? (r.created_at as string),
          ref: (r.ref as AlertItem['ref']) ?? {},
          status: r.status as AlertItem['status'],
          student_label: l?.label ?? null,
        };
      });
    },
    async resolveAlert(id) {
      await db.rpc('resolve_alert', { p_alert: id });
    },

    // ---------------------------------------------------------------- ders raporları
    async lessonAnalyses(): Promise<LessonListItem[]> {
      const analyses = await db.from<LessonAnalysisRow>('lesson_analyses').select('id,lesson_id,status,created_at').order('created_at', { ascending: false });
      const lessonIds = [...new Set(analyses.map((a) => a.lesson_id))];
      const lessons = lessonIds.length ? await db.from<LessonRow>('lessons').select('id,enrollment_id,staff_id,held_at').in('id', lessonIds) : [];
      const enrIds = [...new Set(lessons.map((l) => l.enrollment_id))];
      const enrollments = enrIds.length ? await db.from<{ id: string; student_id: string }>('enrollments').select('id,student_id').in('id', enrIds) : [];
      const studentOf = new Map(enrollments.map((e) => [e.id, e.student_id]));
      const lab = await labels(enrollments.map((e) => e.student_id));
      const names = await staffNames(lessons.map((l) => l.staff_id));
      const lessonById = new Map(lessons.map((l) => [l.id, l]));
      return analyses.flatMap((a) => {
        const l = lessonById.get(a.lesson_id);
        if (!l) return [];
        const sid = studentOf.get(l.enrollment_id);
        const lb = sid ? lab.get(sid) : undefined;
        return [
          {
            analysis_id: a.id,
            lesson_id: a.lesson_id,
            held_at: l.held_at,
            status: a.status,
            student_label: lb?.label ?? '—',
            student_ref: lb?.public_ref ?? '',
            staff_name: l.staff_id ? (names.get(l.staff_id) ?? null) : null,
            created_at: a.created_at,
          },
        ];
      });
    },
    async lessonDetail(id): Promise<LessonDetail | null> {
      const cols = 'id,lesson_id,version,seed_profile,analysis,model,cost_usd,status,approved_by,approved_at,created_at';
      let analysis = await db.from<LessonAnalysisRow>('lesson_analyses').select(cols).eq('id', id).maybeSingle();
      if (!analysis) {
        analysis = await db.from<LessonAnalysisRow>('lesson_analyses').select(cols).eq('lesson_id', id).order('version', { ascending: false }).limit(1).maybeSingle();
      }
      if (!analysis) return null;
      const lesson = await db
        .from<LessonRow>('lessons')
        .select('id,enrollment_id,staff_id,held_at,duration_min,video_deleted_at,deletion_notified_at,transcript_path,frames_count,status,created_at')
        .eq('id', analysis.lesson_id)
        .maybeSingle();
      if (!lesson) return null;
      const claims = await db
        .from<LessonClaim>('lesson_claims')
        .select('id,analysis_id,kind,curriculum_id,skill_id,misconception_tag,misconception_id,value,quote,speaker,t_start_sec,t_end_sec,status,edited_value,decided_by,decided_at')
        .eq('analysis_id', analysis.id)
        .order('t_start_sec');
      const enr = await db.from<{ id: string; student_id: string; curriculum_id: string }>('enrollments').select('id,student_id,curriculum_id').eq('id', lesson.enrollment_id).maybeSingle();
      const lab = await labels([enr?.student_id]);
      const l = enr ? lab.get(enr.student_id) : undefined;
      const names = await staffNames([lesson.staff_id]);
      const skills = enr ? await db.from<{ id: string; name: string }>('skills').select('id,name').eq('curriculum_id', enr.curriculum_id) : [];
      const mastery = await db
        .from<MasteryRow>('mastery_view')
        .select('skill_id,skill_name,p,evidence_count,is_reliable,band,last_evidence_at')
        .eq('enrollment_id', lesson.enrollment_id);
      return {
        lesson,
        student_label: l?.label ?? '—',
        student_ref: l?.public_ref ?? '',
        staff_name: lesson.staff_id ? (names.get(lesson.staff_id) ?? null) : null,
        analysis: { ...analysis, cost_usd: Number(analysis.cost_usd) },
        claims,
        cost_line: `Ders analizi: ${usd(Number(analysis.cost_usd))} (ayrı bütçe)`,
        skill_names: Object.fromEntries(skills.map((s) => [s.id, s.name])),
        current_mastery: mastery.map((m) => ({ ...m, p: Number(m.p) })),
        min_evidence: await settingNumber('min_evidence', 5),
      };
    },
    async approveLesson(id, decisions: ClaimDecision[]) {
      return db.rpc<number>('approve_lesson_analysis', { p_analysis: id, p_decisions: decisions });
    },
    async registerLesson(meta: LessonMeta) {
      return db.rpc<string>('register_lesson', {
        p_student_ref: meta.student_ref,
        p_staff_id: meta.staff_id,
        p_held_at: meta.held_at,
        p_duration: meta.duration_min,
        p_video_ref: meta.video_ref,
      });
    },

    // ---------------------------------------------------------------- bot cevapları
    async botResponses(filter: BotResponseFilter): Promise<BotResponseRow[]> {
      let q = db.from<Row>('bot_responses').select(BOT_RESPONSE_COLS).order('created_at', { ascending: false }).limit(200);
      if (filter.week) q = q.eq('review_week', filter.week);
      if (filter.flaggedOnly) q = q.eq('flagged', true);
      if (filter.studentRef) {
        const s = await studentByRef(filter.studentRef);
        q = q.eq('student_id', s.id);
      }
      return withBotContext(await q);
    },
    async flag(id, reason) {
      const v = await requireViewer();
      await db.from('bot_responses').update({ flagged: true, flag_reason: reason, flagged_by: v.id, flagged_at: new Date().toISOString() }).eq('id', id);
    },

    // ---------------------------------------------------------------- kuyruk
    async queue(): Promise<QueueRow[]> {
      return db.from<QueueRow>('v_review_queue').select('kind,ref_id,created_at,reason,student_ref,staff_hint').order('created_at');
    },
    async queueDetail(row: QueueRow): Promise<QueueDetail | null> {
      const qcols = 'id,curriculum_id,skill_ids,kind,stem,figure_id,options,difficulty,source,verification,status,model,review_note,created_at';
      const fcols = 'id,tool,alt_text,png_path,width_px,height_px,render_status,vision_status,vision_report,review_status,render_log';
      switch (row.kind) {
        case 'question': {
          const question = await db.from<QuestionRow>('questions').select(qcols).eq('id', row.ref_id).maybeSingle();
          if (!question) return null;
          const figure = question.figure_id ? await db.from<FigureRow>('figures').select(fcols).eq('id', question.figure_id).maybeSingle() : null;
          return { kind: 'question', question, figure, figure_url: figureUrl(figure) };
        }
        case 'figure': {
          const figure = await db.from<FigureRow>('figures').select(fcols).eq('id', row.ref_id).maybeSingle();
          if (!figure) return null;
          const usedBy = await db.from<QuestionRow>('questions').select(qcols).eq('figure_id', figure.id);
          return { kind: 'figure', figure, figure_url: figureUrl(figure), used_by: usedBy };
        }
        case 'misconception': {
          const m = await db
            .from<MisconceptionRow & { enrollment_id: string }>('misconceptions')
            .select('id,enrollment_id,skill_id,tag,text_instructor,text_student,status,evidence_count,first_seen,last_seen,resolved_at')
            .eq('id', row.ref_id)
            .maybeSingle();
          if (!m) return null;
          const ev = await evidenceFor([m.id]);
          const enr = await db.from<{ student_id: string }>('enrollments').select('student_id').eq('id', m.enrollment_id).maybeSingle();
          const lab = await labels([enr?.student_id]);
          return { kind: 'misconception', misconception: m, evidence: ev.get(m.id) ?? [], student_label: enr ? (lab.get(enr.student_id)?.label ?? null) : null };
        }
        case 'pool': {
          const pool = await db.from<PoolRow>('content_pool').select('id,kind,skill_id,misconception_tag,mode,body,status,hit_count').eq('id', row.ref_id).maybeSingle();
          return pool ? { kind: 'pool', pool } : null;
        }
        case 'lesson_analysis': {
          let label: string | null = null;
          if (row.student_ref) {
            const s = await studentByRef(row.student_ref);
            label = (await labels([s.id])).get(s.id)?.label ?? null;
          }
          return { kind: 'lesson_analysis', analysis_id: row.ref_id, student_label: label };
        }
        case 'flagged_response': {
          const rows = await db.from<Row>('bot_responses').select(BOT_RESPONSE_COLS).eq('id', Number(row.ref_id));
          const [response] = await withBotContext(rows);
          return response ? { kind: 'flagged_response', response } : null;
        }
        case 'priority_plan': {
          const rows = await db.from<Row>('exam_priority_plans').select('id,course_id,period,plan,evidence_count,status,approved_by,approved_at,created_at').eq('id', row.ref_id);
          const [plan] = await plansWithCourse(rows);
          return plan ? { kind: 'priority_plan', plan } : null;
        }
        case 'research': {
          const out = await db.from<Row>('research_outputs').select('id,status,output').eq('id', row.ref_id).maybeSingle();
          if (!out) return null;
          const citations = await db
            .from<CitationRow>('citations')
            .select('id,output_id,ordinal,doi,title,authors,venue,year,crossref_status,oa_pdf_url,tldr,status,relevance')
            .eq('output_id', row.ref_id)
            .order('ordinal');
          return {
            kind: 'research',
            research: { id: out.id as string, status: out.status as 'pending_review', output: out.output as never, citations },
          };
        }
        default:
          return null;
      }
    },
    async approveQuestion(id, decision, note) {
      await db.rpc('approve_question', { p_question: id, p_decision: decision, p_note: note });
    },
    async peekAnswerKey(id): Promise<AnswerKeyPeek> {
      return db.rpc<AnswerKeyPeek>('peek_answer_key', { p_question: id });
    },
    async addQuestion(q: NewQuestion) {
      const curriculumId = await activeCurriculum();
      // content_hash not null unique (§3.4): pipelines ile aynı normalleştirme (lib/content-hash.ts).
      // verification: anahtar eğitmenden gelir, SymPy uygulanmaz → set_answer_key sympy_status='not_applicable' ile aynı.
      // status 'pending_review': insert anındaki approve_guard yalnız 'approved'u denetler; satır v_review_queue'ya düşer.
      const [row] = await db.from<{ id: string }>('questions').insert({
        curriculum_id: curriculumId,
        skill_ids: [q.skill_id],
        kind: 'mcq',
        stem: q.stem.trim(),
        options: q.options,
        difficulty: q.difficulty,
        source: 'instructor',
        content_hash: await contentHash(q.stem, q.options),
        verification: { schema: true, sympy: 'not_applicable', render: 'not_applicable', vision: 'not_applicable', attempts: 0 },
        status: 'pending_review',
      });
      if (!row) throw new PanelError('PANEL-FORM', 'soru eklenemedi');
      try {
        await db.rpc('set_answer_key', { p_question: row.id, p_key: { correct_option: q.correct_option, solution: q.solution } });
      } catch (e) {
        // anahtarsız soru bırakma: önce taslağı silmeyi dene; RLS izin vermezse yetimi açıkça bildir
        try {
          await db.from('questions').delete().eq('id', row.id);
        } catch {
          throw new PanelError('PANEL-ORPHAN', `soru ${row.id} cevap anahtarı olmadan kaldı`);
        }
        throw e;
      }
      return row.id;
    },
    async decidePool(id, decision) {
      const v = await requireViewer();
      const fields: Row = { status: decision };
      if (decision === 'approved') Object.assign(fields, { approved_by: v.id, approved_at: new Date().toISOString() });
      await db.from('content_pool').update(fields).eq('id', id);
    },
    async decideFigure(id, decision) {
      // §3.4 check (review_status in ('pending','verified','rejected'))
      if (decision !== 'verified' && decision !== 'rejected') throw new PanelError('PANEL-FORM', 'karar verified|rejected');
      const v = await requireViewer();
      await db.from('figures').update({ review_status: decision, reviewed_by: v.id, reviewed_at: new Date().toISOString() }).eq('id', id);
    },
    async confirmMisconception(id) {
      // §10.3: pending_review → open eğitmen onayıyla; §3.8 E/K misconceptions u (`status`). Yalnız bekleyen satır değişir.
      const rows = await db.from<{ id: string }>('misconceptions').update({ status: 'open' }).eq('id', id).eq('status', 'pending_review');
      if (rows.length === 0) throw new PanelError('PANEL-NOTFOUND', 'yanılgı onay beklemiyor');
    },
    async resolveMisconception(id, observationId) {
      await db.rpc('resolve_misconception', { p_misconception: id, p_observation: observationId });
    },
    async rejectMisconception(id, note) {
      await db.rpc('reject_misconception', { p_misconception: id, p_note: note });
    },
    async setCitationRelevance(citationId, relevance) {
      const v = await requireViewer();
      await db.from('citations').update({ relevance, relevance_by: v.id, relevance_at: new Date().toISOString() }).eq('id', citationId);
    },
    async publishResearch(outputId) {
      await db.from('research_outputs').update({ status: 'released' }).eq('id', outputId);
    },

    // ---------------------------------------------------------------- öğrenciler
    async skills() {
      const curriculumId = await activeCurriculum();
      return db.from<{ id: string; name: string }>('skills').select('id,name').eq('curriculum_id', curriculumId).eq('is_leaf', true).order('order_no');
    },
    async students(): Promise<StudentListItem[]> {
      const rows = await db.from<StudentBase>('students').select('id,public_ref,status,is_minor,tier').neq('status', 'deleted');
      const lab = await labels(rows.map((r) => r.id));
      const ids = rows.map((r) => r.id);
      const links = ids.length ? await db.from<{ staff_id: string; student_id: string }>('staff_students').select('staff_id,student_id').in('student_id', ids) : [];
      const consents = ids.length ? await db.from<ConsentRow>('consents').select('student_id,kind,status').in('student_id', ids).eq('status', 'given') : [];
      return rows.map((r) => {
        const given = new Set(consents.filter((c) => c.student_id === r.id).map((c) => c.kind));
        return {
          student_id: r.id,
          public_ref: r.public_ref,
          label: lab.get(r.id)?.label ?? r.public_ref,
          status: r.status,
          is_minor: r.is_minor,
          tier: r.tier,
          consent_ok: given.has('kvkk_aydinlatma') && (!r.is_minor || given.has('veli_onayi')),
          assigned_staff: links.filter((l) => l.student_id === r.id).map((l) => l.staff_id),
        };
      });
    },
    async student(ref): Promise<StudentDetail | null> {
      const s = await db.from<StudentBase>('students').select('id,public_ref,status,is_minor,tier').eq('public_ref', ref).maybeSingle();
      if (!s) return null;
      const lab = await labels([s.id]);
      const enr = await db
        .from<{ id: string; curriculum_id: string; period_label: string }>('enrollments')
        .select('id,curriculum_id,period_label')
        .eq('student_id', s.id)
        .eq('status', 'active')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!enr) return null;
      const minEvidence = await settingNumber('min_evidence', 5);
      const mastery = await db
        .from<MasteryRow>('mastery_view')
        .select('skill_id,skill_name,p,evidence_count,is_reliable,band,last_evidence_at')
        .eq('enrollment_id', enr.id)
        .order('skill_id');
      const miscon = await db
        .from<MisconceptionRow>('misconceptions')
        .select('id,enrollment_id,skill_id,tag,text_instructor,text_student,status,evidence_count,first_seen,last_seen,resolved_at')
        .eq('enrollment_id', enr.id)
        .eq('status', 'open');
      const ev = await evidenceFor(miscon.map((m) => m.id));
      const summary = await db
        .from<{ week_start: string; body: string; metrics: Row }>('weekly_summaries')
        .select('week_start,body,metrics')
        .eq('student_id', s.id)
        .order('week_start', { ascending: false })
        .limit(1)
        .maybeSingle();
      const today = istanbulDay(new Date());
      const usage = await db.from<{ day: string; kind: string; used: number }>('quota_usage').select('day,kind,used').eq('student_id', s.id).eq('day', today);
      const limits = await db.from<{ kind: string; daily_limit: number }>('quota_limits').select('kind,daily_limit').eq('tier', s.tier);
      const attempts = await db
        .from<AttemptRow & { question_id: string }>('attempts')
        .select('id,question_id,context,is_correct,misconception_tag,graded_at')
        .eq('enrollment_id', enr.id)
        .order('created_at', { ascending: false })
        .limit(10);
      const qids = [...new Set(attempts.map((a) => a.question_id))];
      const stems = qids.length ? await db.from<{ id: string; stem: string }>('questions_public').select('id,stem').in('id', qids) : [];
      const notes = await db
        .from<{ id: string; body: string; skill_id: string | null; author_id: string | null; created_at: string }>('instructor_notes')
        .select('id,body,skill_id,author_id,created_at')
        .eq('enrollment_id', enr.id)
        .order('created_at', { ascending: false });
      const authors = await staffNames(notes.map((n) => n.author_id));
      const skills = await db.from<{ id: string; name: string; is_leaf: boolean }>('skills').select('id,name,is_leaf').eq('curriculum_id', enr.curriculum_id).eq('is_leaf', true).order('order_no');
      return {
        student_id: s.id,
        public_ref: s.public_ref,
        label: lab.get(s.id)?.label ?? s.public_ref,
        status: s.status,
        is_minor: s.is_minor,
        tier: s.tier,
        enrollment_id: enr.id,
        curriculum_id: enr.curriculum_id,
        period: enr.period_label,
        min_evidence: minEvidence,
        mastery: mastery.map((m) => ({ ...m, p: Number(m.p), band: m.band ?? bandOf(Number(m.p)) })),
        open_misconceptions: miscon.map((m) => ({ ...m, evidence: ev.get(m.id) ?? [] })),
        weekly_summary: summary,
        quota: limits.map((l) => ({ day: today, kind: l.kind, daily_limit: l.daily_limit, used: usage.find((u) => u.kind === l.kind)?.used ?? 0 })),
        recent_attempts: attempts.map((a) => ({ ...a, stem: stems.find((q) => q.id === a.question_id)?.stem ?? null })),
        notes: notes.map((n) => ({ id: n.id, body: n.body, skill_id: n.skill_id, author: n.author_id ? (authors.get(n.author_id) ?? null) : null, created_at: n.created_at })),
        skills: skills.map((k) => ({ id: k.id, name: k.name })),
      };
    },
    async addNote(note: NoteInput) {
      return db.rpc<string>('add_instructor_note', {
        p_enrollment: note.enrollment_id,
        p_skill: note.skill_id,
        p_body: note.body,
        p_mastery_estimate: note.mastery_estimate,
        p_approved_fact: note.approved_fact,
      });
    },
    async staff(): Promise<StaffRow[]> {
      return db.from<StaffRow>('staff').select('id,full_name,role,subject,active').order('full_name');
    },
    async assignStudents(staffId, studentIds) {
      const current = await db.from<{ student_id: string }>('staff_students').select('student_id').eq('staff_id', staffId);
      const have = new Set(current.map((c) => c.student_id));
      const want = new Set(studentIds);
      const removed = [...have].filter((id) => !want.has(id));
      const added = [...want].filter((id) => !have.has(id));
      if (removed.length) await db.from('staff_students').delete().eq('staff_id', staffId).in('student_id', removed);
      if (added.length) await db.from('staff_students').insert(added.map((student_id) => ({ staff_id: staffId, student_id })));
    },

    // ---------------------------------------------------------------- onaylar
    async consents(ref): Promise<ConsentSummary[]> {
      let q = db.from<StudentBase>('students').select('id,public_ref,status,is_minor,tier').neq('status', 'deleted');
      if (ref) q = q.eq('public_ref', ref);
      const students = await q;
      const ids = students.map((s) => s.id);
      const lab = await labels(ids);
      const rows = ids.length
        ? await db.from<ConsentRow>('consents').select('id,student_id,kind,legal_text_id,status,method,given_by,evidence,given_at,revoked_at').in('student_id', ids).order('given_at')
        : [];
      return students.map((s) => {
        const mine = rows.filter((c) => c.student_id === s.id);
        const given = new Set(mine.filter((c) => c.status === 'given').map((c) => c.kind));
        const missing: ConsentKind[] = [];
        if (!given.has('kvkk_aydinlatma')) missing.push('kvkk_aydinlatma');
        if (s.is_minor && !given.has('veli_onayi')) missing.push('veli_onayi');
        return {
          student_id: s.id,
          public_ref: s.public_ref,
          label: lab.get(s.id)?.label ?? s.public_ref,
          is_minor: s.is_minor,
          status: s.status,
          consent_ok: missing.length === 0,
          missing,
          consents: mine,
          // açık veli kodu secure.guardian_codes'tadır; panel bu şemayı okuyamaz
          guardian_code_open: false,
        };
      });
    },
    async mintGuardianCode(ref, channel) {
      const s = await studentByRef(ref);
      return db.rpc<string>('mint_guardian_code', { p_student: s.id, p_channel: channel });
    },
    async redeemGuardianToken(token, form: GuardianForm) {
      // yalnız anon'a açık (§3.9): oturum açık personel tarayıcısında da anon anahtarıyla çağrılır
      return db.rpc<boolean>('redeem_guardian_token', { p_token: token, p_form: form }, { anon: true });
    },
    async guardianFormText() {
      // anon legal_texts / retention_policies okuyamaz (§3.8): derleme anındaki sürümlü metin + placeholders.json günleri.
      // Açık madde (README): M02'den anon okunabilir legal_text_public(kind) RPC'si gelince buradan okunur.
      return guardianFormText(null, null, null);
    },
    async recordStaffConsent(ref, kind, method, evidence) {
      const s = await studentByRef(ref);
      return db.rpc<string>('record_staff_consent', { p_student: s.id, p_kind: kind, p_method: method, p_evidence: evidence });
    },
    async revokeConsent(consentId) {
      const rows = await db.from<{ id: string; student_id: string }>('consents').update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('id', consentId);
      if (rows[0]) await recomputeStudentStatus(rows[0].student_id);
    },
    async setMinor(ref, isMinor) {
      const rows = await db.from<{ id: string }>('students').update({ is_minor: isMinor }).eq('public_ref', ref);
      if (rows[0]) await recomputeStudentStatus(rows[0].id);
    },
    async legalTexts(): Promise<LegalText[]> {
      return db.from<LegalText>('legal_texts').select('id,kind,version,body_md,effective_from').order('kind').order('effective_from', { ascending: false });
    },
    async deletionRequests(): Promise<DeletionRequest[]> {
      const rows = await db.from<{ id: string; student_id: string | null; status: string; created_at: string }>('escalations').select('id,student_id,status,created_at').eq('reason', 'deletion_request').order('created_at');
      const lab = await labels(rows.map((r) => r.student_id));
      return rows.map((r) => ({ id: r.id, status: r.status, created_at: r.created_at, student_label: r.student_id ? (lab.get(r.student_id)?.label ?? null) : null }));
    },
    async studentFullName(ref) {
      const s = await studentByRef(ref);
      return db.rpc<string | null>('student_full_name', { p_student: s.id });
    },
    async updateStudentPii(ref, fields: PiiFields) {
      const s = await studentByRef(ref);
      await db.rpc('update_student_pii', { p_student: s.id, p_fields: fields });
    },
    async auditRecent(limit): Promise<AuditEvent[]> {
      return db.rpc<AuditEvent[]>('audit_recent', { p_limit: limit });
    },

    // ---------------------------------------------------------------- maliyet
    async spend(): Promise<SpendView> {
      const today = istanbulDay(new Date());
      const month = today.slice(0, 7);
      const ledger = await db.from<SpendLedgerRow>('spend_ledger').select('day,purpose,provider,calls,tokens_in,tokens_out,cost_usd').gte('day', `${month}-01`).order('day');
      const flags = await db.from<{ key: string; value: unknown }>('runtime_flags').select('key,value');
      const [check] = await db.rpc<CheckSpendResult[]>('check_spend', { p_purpose: 'chat' });
      const sizes = await db.from<{ day: string; table_name: string; total_bytes: number; row_estimate: number | null }>('table_sizes_daily').select('day,table_name,total_bytes,row_estimate').order('day', { ascending: false }).limit(60);
      const lastDay = sizes[0]?.day;
      const pool = await db.from<{ status: string; hit_count: number }>('content_pool').select('status,hit_count');
      const metrics = await db.from<PilotMetricRow>('pilot_metrics').select('metric,period,value,detail,computed_at').order('period', { ascending: false });
      const gate = await db.from<{ value: Record<string, unknown> }>('settings').select('value').eq('key', 'pilot_gate').maybeSingle();
      return {
        today,
        month,
        ledger: ledger.map((r) => ({ ...r, cost_usd: Number(r.cost_usd) })),
        flags: Object.fromEntries(flags.map((f) => [f.key, f.value])),
        check: check as CheckSpendResult,
        table_sizes: sizes.filter((s) => s.day === lastDay),
        pool: {
          approved: pool.filter((p) => p.status === 'approved').length,
          pending: pool.filter((p) => p.status === 'pending_review').length,
          hits: pool.reduce((a, p) => a + (p.hit_count ?? 0), 0),
        },
        pilot_metrics: metrics.map((m) => ({ ...m, value: m.value === null ? null : Number(m.value) })),
        pilot_gate: gate?.value ?? {},
      };
    },
    async setFlag(key, value) {
      await db.rpc('set_runtime_flag', { p_key: key, p_value: value });
    },
    async pilotGate(): Promise<GateResult> {
      const metrics = await db.from<PilotMetricRow>('pilot_metrics').select('metric,period,value,detail,computed_at');
      const gate = await db.from<{ value: Record<string, unknown> }>('settings').select('value').eq('key', 'pilot_gate').maybeSingle();
      const rows = metrics.map((m) => ({ ...m, value: m.value === null ? null : Number(m.value) }));
      return evaluatePilotGate(gate?.value ?? {}, rows, ciStatusFromMetrics(rows));
    },

    // ---------------------------------------------------------------- öncelik planı
    async courses(): Promise<CourseRow[]> {
      return db.from<CourseRow>('courses').select('id,code,title,curriculum_id').order('code');
    },
    async priorityPlans(course): Promise<PriorityPlanRow[]> {
      const c = await db.from<{ id: string }>('courses').select('id').eq('code', course).maybeSingle();
      if (!c) return [];
      const rows = await db.from<Row>('exam_priority_plans').select('id,course_id,period,plan,evidence_count,status,approved_by,approved_at,created_at').eq('course_id', c.id).order('created_at', { ascending: false });
      return plansWithCourse(rows);
    },
    async approvePriorityPlan(id, decision) {
      await db.rpc('approve_priority_plan', { p_plan: id, p_decision: decision });
    },
    async examSources(courseId): Promise<ExamSourceRow[]> {
      return db.from<ExamSourceRow>('exam_sources').select('id,course_id,year,term,instructor_alias,storage_path,legal_basis,status,error,created_at').eq('course_id', courseId).order('created_at', { ascending: false });
    },
    async examItems(ids): Promise<ExamItemRow[]> {
      if (ids.length === 0) return [];
      const v = await requireViewer();
      if (v.role === 'observer') {
        return db.from<ExamItemRow>('exam_items').select('id,source_id,item_no,topic,kind,points,skill_id').in('id', ids);
      }
      return db.from<ExamItemRow>('v_exam_items_full').select('id,source_id,item_no,topic,kind,points,skill_id,ocr_text').in('id', ids);
    },
    async uploadExamSource(file, meta: ExamSourceMeta) {
      assertExamUpload(file, meta);
      const v = await requireViewer();
      const id = crypto.randomUUID();
      await db.uploadObject('exams', `${id}.pdf`, file, 'application/pdf');
      try {
        const [row] = await db.from<ExamSourceRow>('exam_sources').insert({
          id,
          course_id: meta.course_id,
          year: meta.year,
          term: meta.term,
          instructor_alias: meta.instructor_alias,
          storage_path: `exams/${id}.pdf`,
          legal_basis: meta.legal_basis,
          uploaded_by: v.id,
          status: 'uploaded',
        });
        if (!row) throw new PanelError('PANEL-FORM', 'arşiv kaydı yazılamadı');
        return row;
      } catch (e) {
        // kayıt yazılamadıysa Storage'da yetim PDF bırakma
        await db.removeObject('exams', `${id}.pdf`).catch(() => undefined);
        throw e;
      }
    },

    // ---------------------------------------------------------------- gruplar
    async chats(): Promise<ChatRow[]> {
      const chats = await db
        .from<Omit<ChatRow, 'members'>>('tg_chats')
        .select('chat_id,kind,title,bot_is_admin,bot_can_pin,privacy_mode_off_verified,retention_days,recording_notice_days,group_auto_answer_min')
        .in('kind', ['group', 'supergroup'])
        .order('chat_id');
      const ids = chats.map((c) => c.chat_id);
      const roles = ids.length
        ? await db.from<{ chat_id: number; telegram_user_id: number; role: string; student_id: string | null; staff_id: string | null; mention_handle: string | null; joined_at: string }>('chat_roles').select('chat_id,telegram_user_id,role,student_id,staff_id,mention_handle,joined_at').in('chat_id', ids)
        : [];
      const lab = await labels(roles.map((r) => r.student_id));
      const names = await staffNames(roles.map((r) => r.staff_id));
      return chats.map((c) => ({
        ...c,
        members: roles
          .filter((r) => r.chat_id === c.chat_id)
          .map<ChatMember>((r) => ({
            telegram_user_id: r.telegram_user_id,
            role: r.role,
            label: r.student_id ? (lab.get(r.student_id)?.label ?? null) : r.staff_id ? (names.get(r.staff_id) ?? null) : null,
            mention_handle: r.mention_handle,
            joined_at: r.joined_at,
          })),
      }));
    },
    async updateChat(id, fields) {
      // tg_chats.retention_days'te CHECK yok (§3.5): 0 gün saklama geçmişi siler → mock ile aynı aralık denetimi, istek gitmez
      assertChatFields(fields);
      const patch: Row = {};
      if (fields.group_auto_answer_min !== undefined) patch.group_auto_answer_min = fields.group_auto_answer_min;
      if (fields.retention_days !== undefined) patch.retention_days = fields.retention_days;
      if (Object.keys(patch).length === 0) return;
      await db.from('tg_chats').update(patch).eq('chat_id', id);
    },
    async linkStaffTelegram(staffId, tgUserId, username, handle) {
      await db.rpc('link_staff_telegram', { p_staff: staffId, p_telegram_user_id: tgUserId, p_username: username, p_mention_handle: handle });
    },
    async mintStaffCode(staffId) {
      return db.rpc<string>('mint_staff_code', { p_staff: staffId });
    },
  };
  return ds;
}
