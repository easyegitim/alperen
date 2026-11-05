/**
 * Deneme hattının veritabanı yolu. Yazımlar 0030/0032 RPC'leriyle (set_exam_progress, register_exam_questions,
 * set_exam_keys, record_exam_answers, grade_exam_session, register_generated_document); worker güvenilir çağırandır
 * (doğrudan Postgres, app.is_trusted). Okumalar doğrudan tablolardan; anahtar değerleri yalnız worker içinde kalır.
 */
import type { Db } from '../db.js';
import type { JobContext } from '../jobs/types.js';
import { emitNotification, enqueueEmailIfNeeded } from '../notifications/engine.js';
import type { KeyRow } from './grading.js';
import type { ReportData, ReportQuestion } from './report.js';
import { foldTr, type SkillLeaf } from './skills.js';
import { istanbulDate } from './util.js';

export interface SessionRow {
  id: string;
  exam_id: string;
  enrollment_id: string;
  mode: string;
  status: string;
  upload_ids: string[];
  progress: Record<string, unknown>;
  report_document_id: string | null;
  /** Notlandı mı (score dolu). */
  graded: boolean;
  finished_at: string | null;
  started_at: string | null;
  exam_title: string;
  exam_publisher: string | null;
  exam_status: string;
  exam_created_by: string | null;
  duration_min: number | null;
  is_copyrighted: boolean;
  curriculum_id: string;
  course_id: string | null;
  course_title: string | null;
  student_id: string;
  public_ref: string;
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export async function loadSession(db: Db, sessionId: string): Promise<SessionRow | null> {
  const r = await db.query(
    `select es.id, es.exam_id, es.enrollment_id, es.mode, es.status, es.upload_ids, es.progress, es.report_document_id,
            es.score is not null as graded, es.finished_at, es.started_at, x.title as exam_title, x.publisher as exam_publisher, x.status as exam_status,
            x.created_by as exam_created_by, app.exam_duration_min(x.id) as duration_min, x.is_copyrighted,
            e.curriculum_id, e.course_id, co.title as course_title, e.student_id, st.public_ref
       from public.exam_sessions es
       join public.exams x on x.id = es.exam_id
       join public.enrollments e on e.id = es.enrollment_id
       join public.students st on st.id = e.student_id
       left join public.courses co on co.id = e.course_id
      where es.id = $1::uuid`,
    [sessionId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    exam_id: String(row.exam_id),
    enrollment_id: String(row.enrollment_id),
    mode: String(row.mode),
    status: String(row.status),
    upload_ids: ((row.upload_ids as unknown[] | null) ?? []).map(String),
    progress: (row.progress as Record<string, unknown> | null) ?? {},
    report_document_id: str(row.report_document_id),
    graded: Boolean(row.graded),
    finished_at: row.finished_at ? new Date(row.finished_at as string).toISOString() : null,
    started_at: row.started_at ? new Date(row.started_at as string).toISOString() : null,
    exam_title: String(row.exam_title),
    exam_publisher: str(row.exam_publisher),
    exam_status: String(row.exam_status),
    exam_created_by: str(row.exam_created_by),
    duration_min: row.duration_min === null || row.duration_min === undefined ? null : Number(row.duration_min),
    is_copyrighted: Boolean(row.is_copyrighted),
    curriculum_id: String(row.curriculum_id),
    course_id: str(row.course_id),
    course_title: str(row.course_title),
    student_id: String(row.student_id),
    public_ref: String(row.public_ref),
  };
}

export interface PageUpload {
  id: string;
  owner_id: string;
  student_id: string | null;
  kind: string;
  storage_path: string;
  mime: string | null;
  status: string;
  anthropic_file_id: string | null;
}

export async function loadUploads(db: Db, ids: readonly string[]): Promise<PageUpload[]> {
  const r = await db.query(
    `select id, owner_id, student_id, kind, storage_path, mime, status, anthropic_file_id from public.uploads where id = any($1::uuid[])`,
    [ids],
  );
  const by = new Map(r.rows.map((u) => [String(u.id), u]));
  return ids.flatMap((id) => {
    const u = by.get(id);
    return u
      ? [{ id, owner_id: String(u.owner_id), student_id: str(u.student_id), kind: String(u.kind), storage_path: String(u.storage_path), mime: str(u.mime), status: String(u.status), anthropic_file_id: str(u.anthropic_file_id) }]
      : [];
  });
}

/** Türetilmiş görüntü (normalleştirilmiş sayfa, şekil kırpımı): aynı Storage yolu varsa o satır döner. */
export async function ensureDerivedUpload(
  db: Db,
  u: { owner_id: string; student_id: string | null; storage_path: string; mime: string; bytes: number; width: number; height: number },
): Promise<string> {
  const prev = await db.query('select id from public.uploads where storage_path = $1 and owner_id = $2::uuid limit 1', [u.storage_path, u.owner_id]);
  if (prev.rows[0]) return String(prev.rows[0].id);
  const r = await db.query(
    `insert into public.uploads (owner_id, student_id, kind, storage_path, mime, bytes, width, height, status)
     values ($1::uuid, $2::uuid, 'photo', $3, $4, $5, $6, $7, 'ready') returning id`,
    [u.owner_id, u.student_id, u.storage_path, u.mime, u.bytes, u.width, u.height],
  );
  return String(r.rows[0]!.id);
}

export async function setFileId(db: Db, uploadId: string, fileId: string): Promise<void> {
  await db.query('update public.uploads set anthropic_file_id = $2 where id = $1::uuid', [uploadId, fileId]);
}

export async function setProgress(db: Db, sessionId: string, stage: string, counters: Record<string, string | number | boolean | null> = {}): Promise<Record<string, unknown>> {
  const r = await db.query('select public.set_exam_progress($1::uuid, $2, $3::jsonb) as p', [sessionId, stage, JSON.stringify(counters)]);
  return (r.rows[0]?.p as Record<string, unknown>) ?? {};
}

export async function loadLeaves(db: Db, curriculumId: string): Promise<SkillLeaf[]> {
  const r = await db.query('select id, name, description from public.skills where curriculum_id = $1::uuid and is_leaf order by order_no, id', [curriculumId]);
  return r.rows.map((s) => ({ id: String(s.id), name: String(s.name), description: str(s.description) }));
}

export interface RegisterItem {
  no: number;
  section: string | null;
  kind: string;
  stem_text: string | null;
  options: { key: string; text: string }[] | null;
  skill_ids: string[];
  page_upload_id: string | null;
  figure_upload_id: string | null;
  bbox?: { x: number; y: number; w: number; h: number } | null;
}

export async function registerQuestions(db: Db, examId: string, items: readonly RegisterItem[]): Promise<{ question_count: number; questions: { no: number; id: string }[] }> {
  const r = await db.query('select public.register_exam_questions($1::uuid, $2::jsonb) as r', [examId, JSON.stringify(items)]);
  return r.rows[0]!.r as { question_count: number; questions: { no: number; id: string }[] };
}

export interface SetKeysResult {
  written: number;
  question_count: number;
  keyed: number;
  missing_nos: number[];
  answer_key_source: string | null;
  unverified: number;
}

export async function setKeys(db: Db, examId: string, keys: readonly KeyRow[], source: string): Promise<SetKeysResult> {
  const r = await db.query('select public.set_exam_keys($1::uuid, $2::jsonb, $3) as r', [
    examId,
    JSON.stringify(keys.map((k) => ({ no: k.no, correct_option: k.correct_option, numeric_value: k.numeric_value, confidence: k.confidence }))),
    source,
  ]);
  return r.rows[0]!.r as SetKeysResult;
}

export async function recordAnswers(db: Db, sessionId: string, answers: readonly { no: number; answer: string | null }[]): Promise<{ written: number; missing_nos: number[] }> {
  const r = await db.query('select public.record_exam_answers($1::uuid, $2::jsonb) as r', [sessionId, JSON.stringify(answers)]);
  return r.rows[0]!.r as { written: number; missing_nos: number[] };
}

export async function gradeSession(db: Db, sessionId: string): Promise<Record<string, unknown>> {
  const r = await db.query('select public.grade_exam_session($1::uuid) as s', [sessionId]);
  return (r.rows[0]?.s as Record<string, unknown>) ?? {};
}

export async function sessionView(db: Db, sessionId: string): Promise<Record<string, unknown>> {
  const r = await db.query('select public.exam_session_view($1::uuid) as v', [sessionId]);
  return (r.rows[0]?.v as Record<string, unknown>) ?? {};
}

/** Mevcut anahtarlar (yeniden denemede ya da eğitmenin önceden girdiği). */
export async function existingKeys(db: Db, examId: string): Promise<(KeyRow & { source: string })[]> {
  const r = await db.query(
    `select q.no, k.correct_option, k.numeric_value, k.confidence, k.source
       from public.exam_questions q join secure.exam_answer_keys k on k.exam_question_id = q.id
      where q.exam_id = $1::uuid order by q.no`,
    [examId],
  );
  return r.rows.map((k) => ({
    no: Number(k.no),
    correct_option: str(k.correct_option),
    numeric_value: k.numeric_value === null ? null : Number(k.numeric_value),
    confidence: k.confidence === null ? null : Number(k.confidence),
    source: String(k.source),
  }));
}

/** submit_exam_upload'un başlık verilmediğinde yazdığı varsayılan ("Okul denemesi · 3 Kas"; app.exam_default_title). */
export function isDefaultExamTitle(title: string): boolean {
  return /^okul denemesi \d{1,2} [a-z]{3}$/.test(foldTr(title));
}

/** Kök metni benzerliği: katlanmış sözcük kümelerinin Jaccard oranı (OCR gürültüsüne dayanıklı). */
export function stemSimilarity(a: string, b: string): number {
  const wa = new Set(foldTr(a).split(' ').filter(Boolean));
  const wb = new Set(foldTr(b).split(' ').filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter += 1;
  return inter / (wa.size + wb.size - inter);
}

/** Örneklenen soruların (ilk, orta, son; en çok 3) kökleri eşleşmeli. */
export const PUBLISHER_SAMPLE = 3;
export const PUBLISHER_STEM_MIN = 0.8;

/** İçerik denetimi için örnek soru numaraları (kökü dolu olanlardan ilk, orta, son). */
export function sampleNos(questions: readonly { no: number; stem_text: string }[], n = PUBLISHER_SAMPLE): number[] {
  const withStem = questions.filter((q) => q.stem_text.trim().length > 0).map((q) => q.no).sort((a, b) => a - b);
  if (withStem.length <= n) return withStem;
  const picks = new Set<number>();
  for (let i = 0; i < n; i++) picks.add(withStem[Math.round((i * (withStem.length - 1)) / (n - 1))]!);
  return [...picks];
}

/** Aday sınavın kökleri bu kitapçıkla örneklenen numaralarda eşleşiyor mu (saf; testli). */
export function sameBooklet(mine: readonly { no: number; stem_text: string }[], theirs: ReadonlyMap<number, string | null>): boolean {
  const nos = sampleNos(mine);
  if (nos.length === 0) return false;
  const byNo = new Map(mine.map((q) => [q.no, q.stem_text]));
  return nos.every((no) => {
    const t = theirs.get(no);
    return typeof t === 'string' && stemSimilarity(byNo.get(no) ?? '', t) >= PUBLISHER_STEM_MIN;
  });
}

/**
 * Yayıncı anahtarı (PLAN-v2 §8 "eğitmen anahtarı bir kez girer"): aynı müfredatta, aynı yayınevi + başlıklı ve
 * soru kökleri bu kitapçıkla eşleşen önceki sınav. Aday yalnız (a) yayımlanmış sınavın eğitmen/üretilmiş anahtarı ya da
 * (b) aynı kişinin (created_by) kendi önceki yüklemesi (yüklenen anahtar sayfası dahil) olabilir: başka öğrencinin
 * doğrulanmamış anahtar fotoğrafı kimseyi notlamaz. Başlık varsayılansa (öğrenci başlık vermedi) eşleşme aranmaz.
 * Soru numarasına göre anahtar ve kazanımlar döner. Eşleşme yoksa null. Eşleşen sınavın kimliği öğrenciye açılmaz
 * (çağıran stash'e yazar).
 */
export async function publisherMatch(
  db: Db,
  exam: { id: string; publisher: string | null; title: string; curriculum_id: string; created_by: string | null },
  questions: readonly { no: number; stem_text: string }[],
): Promise<{ examId: string; keys: (KeyRow & { source: string })[]; skills: Map<number, string[]> } | null> {
  if (!exam.publisher?.trim() || !exam.title.trim() || isDefaultExamTitle(exam.title)) return null;
  // Türkçe büyük/küçük harf (İ/ı, Ö/ö) veritabanı yerel ayarına bırakılmaz: aday listesi JS'te katlanarak karşılaştırılır
  const r = await db.query(
    `select x.id, x.publisher, x.title, (x.status = 'published') as published from public.exams x
      where x.id <> $1::uuid and x.curriculum_id = $2::uuid and x.publisher is not null
        and ((x.status = 'published'
              and exists (select 1 from public.exam_questions q join secure.exam_answer_keys k on k.exam_question_id = q.id
                           where q.exam_id = x.id and k.source in ('instructor', 'generated')))
          or ($3::uuid is not null and x.created_by = $3::uuid
              and exists (select 1 from public.exam_questions q join secure.exam_answer_keys k on k.exam_question_id = q.id
                           where q.exam_id = x.id and k.source <> 'inferred')))
      order by (x.status = 'published') desc, x.created_at desc limit 500`,
    [exam.id, exam.curriculum_id, exam.created_by],
  );
  const pub = foldTr(exam.publisher);
  const title = foldTr(exam.title);
  const cands = r.rows.filter((x) => foldTr(String(x.publisher)) === pub && foldTr(String(x.title)) === title);
  for (const c of cands) {
    const id = String(c.id);
    const qs = await db.query('select no, stem_text, skill_ids from public.exam_questions where exam_id = $1::uuid', [id]);
    const stems = new Map<number, string | null>(qs.rows.map((q) => [Number(q.no), str(q.stem_text)]));
    if (!sameBooklet(questions, stems)) continue;
    const allowed = c.published ? new Set(['instructor', 'generated']) : new Set(['uploaded', 'instructor', 'generated']);
    const keys = (await existingKeys(db, id)).filter((k) => allowed.has(k.source));
    if (keys.length === 0) continue;
    return { examId: id, keys, skills: new Map(qs.rows.map((q) => [Number(q.no), ((q.skill_ids as unknown[] | null) ?? []).map(String)])) };
  }
  return null;
}

/** Rapor verisi: exam_session_view (özet, bölümler, ısı haritası) + soru başına satırlar (anahtar kaynağı, teşhis nedeni). */
export async function loadReportData(db: Db, s: SessionRow, doubleMarks: ReadonlySet<number>, now: Date): Promise<ReportData> {
  const view = await sessionView(db, s.id);
  const summary = (view.summary as Record<string, unknown> | null) ?? {};
  const rows = await db.query(
    `select q.no, q.section, q.skill_ids, r.outcome, r.answer, r.time_spent_sec, r.blank_reason, k.correct_option, k.numeric_value,
            k.source as key_source, sa.error_cause,
            (select sk.name from public.skills sk where sk.curriculum_id = $2::uuid and sk.id = q.skill_ids[1]) as skill_name
       from public.exam_responses r
       join public.exam_questions q on q.id = r.exam_question_id
       left join secure.exam_answer_keys k on k.exam_question_id = q.id
       left join public.solution_analyses sa on sa.id = r.solution_analysis_id
      where r.session_id = $1::uuid
      order by q.no`,
    [s.id, s.curriculum_id],
  );
  const questions: ReportQuestion[] = rows.rows.map((q) => ({
    no: Number(q.no),
    section: str(q.section),
    skillId: ((q.skill_ids as unknown[] | null) ?? []).map(String)[0] ?? null,
    skillName: str(q.skill_name),
    outcome: (str(q.outcome) as ReportQuestion['outcome']) ?? null,
    marked: str(q.answer),
    doubleMark: doubleMarks.has(Number(q.no)),
    key: q.correct_option ? String(q.correct_option) : q.numeric_value !== null && q.numeric_value !== undefined ? String(q.numeric_value).replace('.', ',') : null,
    keySource: str(q.key_source),
    errorCause: str(q.error_cause) ?? (q.blank_reason === 'time' ? 'time' : null),
    seconds: q.time_spent_sec === null || q.time_spent_sec === undefined ? null : Number(q.time_spent_sec),
  }));
  const sections = ((view.sections as Record<string, unknown>[] | null) ?? []).map((x) => ({
    name: String(x.title ?? x.section ?? 'Genel'),
    questionCount: Number(x.total ?? 0),
    correct: Number(x.correct ?? 0),
    wrong: Number(x.wrong ?? 0),
    blank: Number(x.blank ?? 0) + Number(x.unfinished ?? 0),
    net: Number(x.net ?? 0),
  }));
  const heatmap = ((view.heatmap as Record<string, unknown>[] | null) ?? []).map((h) => ({
    skillId: String(h.skill_id),
    name: String(h.name),
    total: Number(h.total ?? 0),
    correct: Number(h.correct ?? 0),
  }));
  const weak = summary.weakest as { skill_id?: unknown; name?: unknown } | null | undefined;
  return {
    examTitle: s.exam_title,
    courseTitle: s.course_title ?? 'Ders',
    date: istanbulDate(s.finished_at ? new Date(s.finished_at) : now),
    durationMin: s.duration_min,
    total: Number(summary.total ?? questions.length),
    correct: Number(summary.correct ?? 0),
    wrong: Number(summary.wrong ?? 0),
    blank: Number(summary.blank ?? 0) + Number(summary.unfinished ?? 0),
    net: Number(summary.net ?? 0),
    sections,
    heatmap,
    questions,
    weakest: weak && weak.skill_id ? { skillId: String(weak.skill_id), name: String(weak.name) } : null,
  };
}

/**
 * Velilere `exam_analysed` bildirimi (kural motoru: emit_notification; kural kapalıysa yazılmaz, kanallar kuraldan, push
 * aboneliği varsa push.send, e-posta kanalı varsa email.send). Tekilleştirme anahtarı `session:<id>`, 0042 tetikleyicisinin
 * (exam_sessions → done) anahtarıyla aynıdır: tetikleyici oturum `done` olurken (register_generated_document) genel metinle
 * önce yazmışsa yeni satır açılmaz, o satırın metni hattın daha zengin cümlesiyle (net + en çok zorlandığı konu) ve rapor
 * bağlantısıyla güncellenir. Döner: bildirimi olan veli sayısı.
 */
export async function notifyParents(
  ctx: Pick<JobContext, 'db' | 'enqueue'>,
  s: SessionRow,
  line: string,
  documentId: string | null,
): Promise<number> {
  const parents = await ctx.db.query(
    `select gl.parent_id from public.guardian_links gl
      where gl.student_id = $1::uuid and gl.status = 'active' and gl.parent_id is not null
      order by gl.parent_id`,
    [s.student_id],
  );
  const dedupeKey = `session:${s.id}`;
  const url = documentId ? `/veli/rapor/${documentId}` : '/veli';
  let n = 0;
  for (const row of parents.rows) {
    const parent = String(row.parent_id);
    let id = await emitNotification(ctx, parent, 'exam_analysed', {
      student_id: s.student_id,
      session_id: s.id,
      exam_id: s.exam_id,
      exam_title: s.exam_title,
      report_document_id: documentId,
      dedupe_key: dedupeKey,
      body: line,
      url,
    });
    if (!id) {
      const upd = await ctx.db.query(
        `update public.notifications n
            set body = $3,
                payload = n.payload || jsonb_strip_nulls(jsonb_build_object('report_document_id', $4::text, 'url', $5::text))
          where n.recipient_id = $1::uuid and n.kind = 'exam_analysed' and n.payload ->> 'dedupe_key' = $2
            and n.read_at is null
          returning n.id`,
        [parent, dedupeKey, line, documentId, url],
      );
      id = upd.rows[0]?.id ? String(upd.rows[0].id) : null;
      if (id) await enqueueEmailIfNeeded(ctx, id);
    }
    if (id) n += 1;
  }
  return n;
}

/**
 * Karalama sayfası varsa yanlış/boş sorular için deneme bağlamlı teşhis (app.exam_enqueue_diagnosis: diagnosis.run
 * {context: exam, exam_response_id …} + audit 'exam.how_far'). Sorunun kitapçık sayfası + karalamalar (≤ 4) gider;
 * exam_responses.work_upload_ids yazılır (sonuç ekranında "inceleniyor"). Önce yanlışlar, sonra boşlar; en çok `max`.
 */
export async function enqueueExamDiagnoses(db: Db, sessionId: string, scratchIds: readonly string[], max: number): Promise<number> {
  if (scratchIds.length === 0 || max <= 0) return 0;
  const r = await db.query(
    `with picked as (
       select r.id, (array_remove(array[q.page_upload_id], null) || $2::uuid[])[1:4] as ids
         from public.exam_responses r join public.exam_questions q on q.id = r.exam_question_id
        where r.session_id = $1::uuid and r.outcome in ('wrong', 'blank') and r.solution_analysis_id is null
          and not exists (select 1 from audit.events ae where ae.action = 'exam.how_far' and ae.row_id = r.id::text)
        order by (r.outcome = 'wrong') desc, q.no
        limit $3
     ), marked as (
       update public.exam_responses r set work_upload_ids = p.ids from picked p where r.id = p.id and cardinality(r.work_upload_ids) = 0
       returning r.id
     )
     select p.id, app.exam_enqueue_diagnosis(p.id, null, p.ids) as job from picked p left join marked m on m.id = p.id`,
    [sessionId, scratchIds, max],
  );
  return r.rows.length;
}
