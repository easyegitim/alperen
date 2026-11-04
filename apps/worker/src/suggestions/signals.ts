/**
 * Öneri motoru girdileri: öğrenci başına veritabanı sinyalleri (service_role `pg`). Sorgular yalnız kimlik, kod,
 * sayı ve kısa ad okur; hafıza dosyası, sohbet ya da yükleme içeriği okunmaz.
 */
import type { Db } from '../db.js';
import { consumedRefsOf, istanbulDay, refKey, type EnrollmentSignals, type StudentSignals, type UploadSignal } from './rules.js';

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : str(v));
const dayStr = (v: unknown): string | null => (v instanceof Date ? istanbulDay(v) : str(v)?.slice(0, 10) ?? null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** `instructor_notes.kind` sütunu var mı (ödev kavramı; yoksa 'Ödev:' önekli not). Süreç başına bir kez okunur. */
const kindColumn = new WeakMap<Db, Promise<boolean>>();
function hasNoteKind(db: Db): Promise<boolean> {
  let p = kindColumn.get(db);
  if (!p) {
    p = db
      .query(
        `select 1 from information_schema.columns where table_schema = 'public' and table_name = 'instructor_notes' and column_name = 'kind'`,
      )
      .then((r) => r.rows.length > 0)
      .catch(() => false);
    kindColumn.set(db, p);
  }
  return p;
}

/** Ödev sayılan not: kind = 'homework' (sütun varsa) ya da gövdesi "Ödev:" / "Odev:" ile başlayan not. */
export const HOMEWORK_PREFIX_RE = '^\\s*[ÖöOo][Dd][Ee][Vv]\\s*[:–-]';

async function enrollmentSignals(db: Db, e: Record<string, unknown>): Promise<EnrollmentSignals> {
  const enr = String(e.id);
  const cur = String(e.curriculum_id);
  const course = str(e.course_id);
  const noteKind = await hasNoteKind(db);
  const [leaves, first, mc, notes, claims, lesson] = await Promise.all([
    db.query(
      `select m.skill_id, s.name, m.p::float8 as p, m.evidence_count,
              coalesce((select max(h.created_at) from public.mastery_history h where h.enrollment_id = m.enrollment_id and h.skill_id = m.skill_id),
                       m.last_evidence_at, m.updated_at) as last_at
         from public.mastery m
         join public.skills s on s.curriculum_id = m.curriculum_id and s.id = m.skill_id
        where m.enrollment_id = $1::uuid and s.is_leaf and m.evidence_count > 0
        order by m.p, m.skill_id
        limit 200`,
      [enr],
    ),
    db.query(
      `with recursive t as (
         select s.id, s.name, s.is_leaf, array[s.order_no] as path, array[s.id] as ids
           from public.skills s where s.curriculum_id = $1::uuid and s.parent_id is null
         union all
         select c.id, c.name, c.is_leaf, t.path || c.order_no, t.ids || c.id
           from public.skills c join t on c.parent_id = t.id
          where c.curriculum_id = $1::uuid and cardinality(t.path) < 8
       )
       select id, name from t where is_leaf order by path, ids limit 2`,
      [cur],
    ),
    db.query(
      `select mc.tag, mc.skill_id, s.name as skill_name, mt.prereq_skill_id, ps.name as prereq_name
         from public.misconceptions mc
         join public.skills s on s.curriculum_id = mc.curriculum_id and s.id = mc.skill_id
         left join public.misconception_tags mt on mt.tag = mc.tag
         left join public.skills ps on ps.curriculum_id = mc.curriculum_id and ps.id = mt.prereq_skill_id
        where mc.enrollment_id = $1::uuid and mc.status = 'open'
        order by mc.evidence_count desc, mc.last_seen desc, mc.skill_id
        limit 1`,
      [enr],
    ),
    db.query(
      `select n.id, n.skill_id, s.name as skill_name, n.created_at
         from public.instructor_notes n
         left join public.skills s on s.curriculum_id = n.curriculum_id and s.id = n.skill_id
        where n.enrollment_id = $1::uuid and n.created_at >= now() - interval '7 days'
          and (${noteKind ? "n.kind = 'homework' or " : ''}n.body ~ $2)
        order by n.created_at desc, n.id
        limit 3`,
      [enr, HOMEWORK_PREFIX_RE],
    ),
    db.query(
      `select lc.id, lc.skill_id, s.name as skill_name, lc.created_at
         from public.lesson_claims lc
         join public.lesson_analyses la on la.id = lc.analysis_id
         join public.lessons l on l.id = la.lesson_id
         left join public.skills s on s.curriculum_id = lc.curriculum_id and s.id = lc.skill_id
        where lc.kind = 'homework' and lc.status in ('approved', 'edited')
          and (l.enrollment_id = $1::uuid or (l.enrollment_id is null and l.course_id = $2::uuid))
          and coalesce(lc.decided_at, lc.created_at) >= now() - interval '7 days'
        order by coalesce(lc.decided_at, lc.created_at) desc, lc.id
        limit 3`,
      [enr, course],
    ),
    db.query(
      `select la.id as analysis_id, l.id as lesson_id, l.held_at,
              coalesce((select array_agg(distinct lc.skill_id order by lc.skill_id) from public.lesson_claims lc
                         where lc.analysis_id = la.id and lc.skill_id is not null and lc.status <> 'rejected'), '{}') as skill_ids
         from public.lesson_analyses la
         join public.lessons l on l.id = la.lesson_id
        where la.status in ('approved', 'corrected')
          and (l.enrollment_id = $1::uuid or (l.enrollment_id is null and l.course_id = $2::uuid))
          and l.held_at >= now() - interval '7 days'
        order by l.held_at desc, la.version desc
        limit 1`,
      [enr, course],
    ),
  ]);

  const lessonRow = lesson.rows[0];
  let lessonReview: EnrollmentSignals['lessonReview'] = null;
  if (lessonRow) {
    const ids = strs(lessonRow.skill_ids).slice(0, 3);
    const nm = ids.length
      ? await db.query('select id, name from public.skills where curriculum_id = $1::uuid and id = any($2::text[])', [cur, ids])
      : { rows: [] };
    const byId = new Map(nm.rows.map((r) => [String(r.id), String(r.name)]));
    lessonReview = {
      analysisId: String(lessonRow.analysis_id),
      lessonId: String(lessonRow.lesson_id),
      heldAt: iso(lessonRow.held_at) ?? '',
      skillIds: ids,
      skillNames: ids.map((i) => byId.get(i) ?? i),
    };
  }

  const homework: EnrollmentSignals['homework'] = [
    ...notes.rows.map((r) => ({
      refId: String(r.id),
      source: 'note' as const,
      skillIds: r.skill_id ? [String(r.skill_id)] : [],
      skillNames: r.skill_name ? [String(r.skill_name)] : [],
      createdAt: iso(r.created_at) ?? '',
    })),
    ...claims.rows.map((r) => ({
      refId: String(r.id),
      source: 'lesson_claim' as const,
      skillIds: r.skill_id ? [String(r.skill_id)] : [],
      skillNames: r.skill_name ? [String(r.skill_name)] : [],
      createdAt: iso(r.created_at) ?? '',
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.refId < b.refId ? -1 : 1));
  // Kazanımsız ödev: alıştırma hedefi en zayıf yapraklar olur
  const weakIds = leaves.rows.slice(0, 2).map((r) => String(r.skill_id));
  const weakNames = leaves.rows.slice(0, 2).map((r) => String(r.name));
  const firstIds = first.rows.map((r) => String(r.id));
  const firstNames = first.rows.map((r) => String(r.name));
  for (const h of homework) {
    if (h.skillIds.length === 0) {
      h.skillIds = weakIds.length ? weakIds : firstIds;
      h.skillNames = weakIds.length ? weakNames : firstNames;
    }
  }

  const m0 = mc.rows[0];
  return {
    enrollmentId: enr,
    courseId: course,
    courseTitle: str(e.course_title),
    examDate: dayStr(e.exam_date),
    targetExam: str(e.target_exam),
    leaves: leaves.rows.map((r) => ({ skillId: String(r.skill_id), name: String(r.name), p: Number(r.p), n: Number(r.evidence_count), lastAt: iso(r.last_at) })),
    firstLeaves: first.rows.map((r) => ({ skillId: String(r.id), name: String(r.name) })),
    topMisconception: m0
      ? { tag: str(m0.tag), skillId: String(m0.skill_id), skillName: String(m0.skill_name), prereqSkillId: str(m0.prereq_skill_id), prereqName: str(m0.prereq_name) }
      : null,
    homework: homework.filter((h) => h.skillIds.length > 0),
    lessonReview,
  };
}

/**
 * Öğrencinin tüm sinyalleri. Etkin kayıt yoksa `enrollments` boştur (yalnız belge/yükleme kartları çıkabilir). Kaydın
 * müfredatı onaylanmamış taslaksa ve otopilot etkin değilse kayıt sinyale girmez.
 */
export async function collectSignals(db: Db, studentId: string, now: Date): Promise<StudentSignals> {
  const today = istanbulDay(now);
  const [enr, docs, analyses, sessions, pending, failed, consumed] = await Promise.all([
    db.query(
      // onaylanmamış taslak yalnız otopilot etkinse (PLAN §3.5): öğrenci aksi halde eğitmenin yayınını bekler
      // (start_practice de OGR-PRAC-008 ile reddeder); kurulan ama onaylanmayan taslağın yapraklarına kart yok
      `select e.id, e.curriculum_id, e.course_id, e.exam_date, e.target_exam, co.title as course_title
         from public.enrollments e left join public.courses co on co.id = e.course_id
         join public.curricula c on c.id = e.curriculum_id
        where e.student_id = $1::uuid and e.status = 'active'
          and (c.status = 'active'
               or (c.status = 'draft' and coalesce((public.curriculum_autopilot_state(c.id) ->> 'effective')::boolean, false)))
        order by e.started_at desc, e.created_at desc, e.id
        limit 3`,
      [studentId],
    ),
    db.query(
      `select d.id, d.kind, d.title, d.updated_at,
              (select e.id from public.enrollments e where e.student_id = d.student_id and e.course_id = d.course_id and e.status = 'active'
                order by e.started_at desc limit 1) as enrollment_id
         from public.generated_documents d
        where d.student_id = $1::uuid and d.status in ('rendered', 'published') and d.kind <> 'answer_key'
          and d.updated_at >= now() - interval '7 days'
        order by d.updated_at desc, d.id
        limit 3`,
      [studentId],
    ),
    db.query(
      `select sa.id, sa.enrollment_id, sa.upload_ids[1] as upload_id, sa.upload_ids, sa.verdict, sa.created_at,
              sa.analysis ->> 'one_line' as one_line
         from public.solution_analyses sa join public.enrollments e on e.id = sa.enrollment_id
        where e.student_id = $1::uuid and sa.exam_response_id is null and cardinality(sa.upload_ids) > 0
          and sa.created_at >= now() - interval '48 hours'
        order by sa.created_at desc, sa.id
        limit 2`,
      [studentId],
    ),
    db.query(
      `select es.id, es.enrollment_id, es.exam_id, es.finished_at, (es.score ->> 'net') as net, es.progress ->> 'card_line' as one_line,
              coalesce(es.upload_ids[1]::text, link.row_id) as upload_id,
              case when cardinality(es.upload_ids) > 0 then to_jsonb(es.upload_ids) else link.diff -> 'upload_ids' end as upload_ids
         from public.exam_sessions es join public.enrollments e on e.id = es.enrollment_id
         left join lateral (select ae.row_id, ae.diff from audit.events ae
                             where ae.action = 'exam.upload_intake' and ae.diff ->> 'session_id' = es.id::text
                             order by ae.created_at desc limit 1) link on true
        where e.student_id = $1::uuid and es.mode = 'uploaded' and es.status = 'done'
          and es.finished_at >= now() - interval '48 hours'
        order by es.finished_at desc, es.id
        limit 2`,
      [studentId],
    ),
    // alınan, analizi süren okul denemesi (exam.analyse: grading → analysing): "Denemeni inceliyorum" kartı
    db.query(
      `select es.id, es.enrollment_id, es.started_at, es.exam_id,
              coalesce(es.upload_ids[1]::text, link.row_id) as upload_id,
              case when cardinality(es.upload_ids) > 0 then to_jsonb(es.upload_ids) else link.diff -> 'upload_ids' end as upload_ids
         from public.exam_sessions es join public.enrollments e on e.id = es.enrollment_id
         left join lateral (select ae.row_id, ae.diff from audit.events ae
                             where ae.action = 'exam.upload_intake' and ae.diff ->> 'session_id' = es.id::text
                             order by ae.created_at desc limit 1) link on true
        where e.student_id = $1::uuid and es.mode = 'uploaded' and es.status in ('grading', 'analysing')
          and (cardinality(es.upload_ids) > 0 or link.row_id is not null)
          and es.started_at >= now() - interval '48 hours'
        order by es.started_at desc, es.id
        limit 2`,
      [studentId],
    ),
    // işlenemeyen yükleme (diagnosis.run 'diagnosis.failed'): sayfalar hâlâ 'failed' ve teşhis yoksa kart kalır
    db.query(
      `select ae.row_id as upload_id, ae.diff -> 'upload_ids' as upload_ids, ae.diff ->> 'failure' as failure,
              ae.diff ->> 'reason' as reason, e.id as enrollment_id, ae.created_at
         from audit.events ae join public.enrollments e on e.id::text = ae.diff ->> 'enrollment_id'
        where ae.action = 'diagnosis.failed' and e.student_id = $1::uuid and ae.created_at >= now() - interval '48 hours'
          and exists (select 1 from public.uploads u where u.id::text = ae.row_id and u.status = 'failed')
          and not exists (select 1 from public.solution_analyses sa where sa.enrollment_id = e.id and sa.upload_ids @> array[ae.row_id::uuid])
        order by ae.created_at desc, ae.id desc
        limit 2`,
      [studentId],
    ),
    db.query(
      `select s.kind, s.enrollment_id, s.payload, s.consumed_at from public.suggestions s
        where s.student_id = $1::uuid and s.consumed_at is not null and s.consumed_at >= now() - interval '30 days'`,
      [studentId],
    ),
  ]);
  const enrollments: EnrollmentSignals[] = [];
  for (const e of enr.rows) enrollments.push(await enrollmentSignals(db, e));
  const c = consumedRefsOf(
    consumed.rows.map((r) => ({
      kind: String(r.kind),
      enrollment_id: str(r.enrollment_id),
      payload: (r.payload as Record<string, unknown> | null) ?? {},
      consumed_at: r.consumed_at as string | Date,
    })),
  );
  const uploads: UploadSignal[] = [
    ...analyses.rows.map((r): UploadSignal => ({
      ref: refKey('analysis', String(r.id)),
      state: 'result',
      analysisId: String(r.id),
      sessionId: null,
      uploadId: str(r.upload_id),
      uploadIds: strs(r.upload_ids),
      enrollmentId: String(r.enrollment_id),
      verdict: str(r.verdict),
      oneLine: str(r.one_line),
      at: iso(r.created_at) ?? '',
      net: null,
    })),
    ...sessions.rows.map((r): UploadSignal => ({
      ref: refKey('session', String(r.id)),
      state: 'result',
      analysisId: null,
      sessionId: String(r.id),
      uploadId: str(r.upload_id),
      uploadIds: strs(r.upload_ids),
      enrollmentId: String(r.enrollment_id),
      examId: str(r.exam_id),
      verdict: null,
      oneLine: str(r.one_line),
      at: iso(r.finished_at) ?? '',
      net: r.net === null || r.net === undefined ? null : Number(r.net),
    })),
    ...pending.rows.map((r): UploadSignal => ({
      ref: refKey('upload', String(r.upload_id)),
      state: 'pending',
      analysisId: null,
      sessionId: String(r.id),
      examId: str(r.exam_id),
      uploadId: String(r.upload_id),
      uploadIds: strs(r.upload_ids),
      enrollmentId: String(r.enrollment_id),
      verdict: null,
      at: iso(r.started_at) ?? '',
      net: null,
    })),
    ...failed.rows.map((r): UploadSignal => ({
      ref: refKey('upload', String(r.upload_id)),
      state: 'failed',
      analysisId: null,
      sessionId: null,
      uploadId: String(r.upload_id),
      uploadIds: strs(r.upload_ids),
      enrollmentId: String(r.enrollment_id),
      verdict: null,
      failure: r.failure === 'reading' ? 'reading' : 'processing',
      reason: str(r.reason),
      at: iso(r.created_at) ?? '',
      net: null,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return {
    studentId,
    today,
    enrollments,
    documents: docs.rows.map((r) => ({
      documentId: String(r.id),
      kind: String(r.kind),
      title: String(r.title),
      enrollmentId: str(r.enrollment_id),
      updatedAt: iso(r.updated_at) ?? '',
    })),
    uploads,
    consumedRefs: c.refs,
    practicedToday: c.practicedToday(today),
  };
}
