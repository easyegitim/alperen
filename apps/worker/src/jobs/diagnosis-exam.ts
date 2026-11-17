/**
 * `diagnosis.run` deneme bağlamı (context = 'exam'): bir deneme sorusunun yanlış/boş cevabının teşhisi. Kaynaklar:
 * öğrencinin "Nereye kadar geldim?" metni/fotoğrafları (exam_how_far), uygulama içi denemenin karalama tuvali
 * (finish_exam_session) ya da exam.analyse'ın karalama sayfası dağıtımı (sorunun kitapçık sayfası + karalamalar).
 *
 *   1. Cevap + soru + anahtar (secure; yalnız modele gider) + oturum; kayıt yükteki kayıtla aynı olmalı.
 *   2. Görseller (≤ 4): yükteki sayfalar; hiç yoksa sorunun kitapçık sayfası (model soruyu görsün). Files API.
 *   3. solution_diagnosis (Opus · high, prompt v2 "Deneme bağlamı"): görseller + `<exam_context>` (examContextText) +
 *      soru metni ve öğrencinin yazdığı veri bloğu olarak. Çıktı audit 'diagnosis.raw' (row_id = cevap): yeniden deneme
 *      Opus'u yeniden çağırmaz.
 *   4. validateDiagnosis → apply_diagnosis(exam_response_id): teşhis + exam_responses.solution_analysis_id; deneme
 *      bağlamında gözlem ağırlığı 0 (notlama zaten kanıt yazdı). Bugün kartı yazılmaz (sonuç ekranında görünür).
 *      Telifli denemede (exams.is_copyrighted; her yüklenen deneme) modelin soru transkripsiyonu solution_analyses'e
 *      yazılmaz (question_text null): o tabloyu öğrenci ve veli okur, kök ise yalnız eğitmen/sisteme açıktır (PLAN-v2
 *      §8). Transkripsiyon audit 'diagnosis.raw' satırında ve gömmede kalır.
 * Aynı cevap için ikinci teşhis yazılmaz. Okuma hatası ya da son deneme: fotoğraflar 'failed', audit 'diagnosis.failed'
 * ({exam_response_id, session_id, failure}); öğrenci aynı soruyu yeniden gönderebilir mi kararı SQL'dedir.
 */
import type { SolutionDiagnosis } from '@ogrenmen/contracts';
import { buildPromptSystem, classifyError } from '@ogrenmen/llm';
import { examContextText, type ExamContext } from '@ogrenmen/prompts';
import type { AnswerRow } from '../exam/grading.js';
import { keySourceOf } from '../exam/report.js';
import { stashGet } from '../exam/stash.js';
import { systemPrompt } from '../prompts.js';
import {
  diagnosisOneLine,
  embedDiagnosisText,
  ensureFiles,
  fileUploaderFor,
  isMissingFileError,
  isReadingFailure,
  loadCurriculumIndex,
  MAX_DIAGNOSIS_UPLOADS,
  proposalForApply,
  validateDiagnosis,
  type DiagnosisRunPayload,
  type DiagnosisRunResult,
  type UploadRow,
  type UserBlocks,
} from './diagnosis.js';
import { PermanentJobError } from './errors.js';
import type { JobContext } from './types.js';

const RAW_ACTION = 'diagnosis.raw';
const RETRY_LIMIT = 3;

interface ResponseRow {
  id: string;
  session_id: string;
  enrollment_id: string;
  student_id: string;
  curriculum_id: string;
  course_id: string | null;
  public_ref: string;
  outcome: string | null;
  answer: string | null;
  time_spent_sec: number | null;
  blank_reason: string | null;
  how_far_text: string | null;
  solution_analysis_id: string | null;
  no: number;
  section: string | null;
  kind: string;
  stem_text: string | null;
  options: { key: string; text?: string }[] | null;
  page_upload_id: string | null;
  exam_title: string;
  duration_min: number | null;
  correct_option: string | null;
  numeric_value: number | null;
  key_source: string | null;
  is_copyrighted: boolean;
}

/**
 * Öğrencinin metni ve OCR'lı soru veri bloğunda: `<` `>` karakterleri `‹ ›` olur. Etiket silmek tek geçişte aşılır
 * (`<</student_text>/student_text>`); karakteri değiştirmek hiçbir birleşimde etiket bırakmaz (packages/prompts clean ile aynı).
 */
function clean(s: string, max: number): string {
  return s.replace(/\r/g, '').replace(/</g, '‹').replace(/>/g, '›').trim().slice(0, max);
}

async function loadResponse(ctx: JobContext, id: string): Promise<ResponseRow | null> {
  const r = await ctx.db.query(
    `select r.id, r.session_id, es.enrollment_id, e.student_id, e.curriculum_id, e.course_id, st.public_ref, r.outcome, r.answer,
            r.time_spent_sec, r.blank_reason, r.how_far_text, r.solution_analysis_id, q.no, q.section, q.kind, q.stem_text,
            q.options, q.page_upload_id, x.title as exam_title, app.exam_duration_min(x.id) as duration_min,
            k.correct_option, k.numeric_value, k.source as key_source, x.is_copyrighted
       from public.exam_responses r
       join public.exam_sessions es on es.id = r.session_id
       join public.enrollments e on e.id = es.enrollment_id
       join public.students st on st.id = e.student_id
       join public.exam_questions q on q.id = r.exam_question_id
       join public.exams x on x.id = q.exam_id
       left join secure.exam_answer_keys k on k.exam_question_id = q.id
      where r.id = $1::uuid`,
    [id],
  );
  const x = r.rows[0];
  if (!x) return null;
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    id: String(x.id),
    session_id: String(x.session_id),
    enrollment_id: String(x.enrollment_id),
    student_id: String(x.student_id),
    curriculum_id: String(x.curriculum_id),
    course_id: s(x.course_id),
    public_ref: String(x.public_ref),
    outcome: s(x.outcome),
    answer: s(x.answer),
    time_spent_sec: x.time_spent_sec === null ? null : Number(x.time_spent_sec),
    blank_reason: s(x.blank_reason),
    how_far_text: s(x.how_far_text),
    solution_analysis_id: s(x.solution_analysis_id),
    no: Number(x.no),
    section: s(x.section),
    kind: String(x.kind),
    stem_text: s(x.stem_text),
    options: Array.isArray(x.options) ? (x.options as { key: string; text?: string }[]) : null,
    page_upload_id: s(x.page_upload_id),
    exam_title: String(x.exam_title),
    duration_min: x.duration_min === null || x.duration_min === undefined ? null : Number(x.duration_min),
    correct_option: s(x.correct_option),
    numeric_value: x.numeric_value === null || x.numeric_value === undefined ? null : Number(x.numeric_value),
    key_source: s(x.key_source),
    is_copyrighted: Boolean(x.is_copyrighted),
  };
}

/** `<exam_context>` girdisi (saf; testli). */
export function examContextFor(r: ResponseRow, marks: AnswerRow | null, hasPhotos: boolean, text: string | null): ExamContext {
  const double = marks?.status === 'multiple';
  return {
    examTitle: r.exam_title,
    durationMin: r.duration_min,
    questionNo: r.no,
    section: r.section,
    marked: r.answer,
    markStatus: double ? 'double_mark' : r.answer ? 'marked' : 'blank',
    ...(double ? { marksSeen: marks!.marks_seen } : {}),
    key: r.correct_option ?? (r.numeric_value !== null ? String(r.numeric_value).replace('.', ',') : null),
    keySource: keySourceOf(r.key_source),
    // yayıncı denemesi: kök aynen yazılmaz (PLAN-v2 §8); bu bayrak olmadan telifli kök modele serbest gidiyordu
    isCopyrighted: r.is_copyrighted,
    secondsSpent: r.time_spent_sec,
    studentNote: hasPhotos ? 'photo' : text ? 'text' : r.blank_reason === 'time' ? 'out_of_time' : r.blank_reason === 'not_started' ? 'not_started' : null,
  };
}

/** Kullanıcı turunun metin bloğu: deneme bağlamı + soru (veri) + öğrencinin yazdığı (veri). */
export function examDiagnosisText(c: ExamContext, r: Pick<ResponseRow, 'stem_text' | 'options'>, text: string | null, photos: number): string {
  const parts = [examContextText(c)];
  if (r.stem_text) {
    const opts = (r.options ?? []).filter((o) => o.text).map((o) => `${o.key}) ${clean(o.text!, 300)}`).join(' ');
    parts.push('<question>', clean(r.stem_text, 2500) + (opts ? `\n${opts}` : ''), '</question>');
  }
  if (text) parts.push('<student_text>', clean(text, 2000), '</student_text>');
  parts.push(
    photos > 0
      ? `Görseller (${photos}): kitapçık sayfası ve/veya öğrencinin karalaması. Soruyu bul, öğrencinin bu soru için yaptığını oku; transkripsiyon yok.`
      : 'Görsel yok: öğrencinin yazdığından ve işaretinden teşhis et.',
  );
  return parts.join('\n');
}

async function setStatus(ctx: JobContext, ids: string[], status: 'ready' | 'failed'): Promise<void> {
  if (ids.length) await ctx.db.query(`update public.uploads set status = $2 where id = any($1::uuid[]) and status = 'processing'`, [ids, status]);
}

export async function runExamDiagnosis(p: DiagnosisRunPayload, ctx: JobContext): Promise<DiagnosisRunResult> {
  const r = await loadResponse(ctx, p.exam_response_id!);
  if (!r || r.enrollment_id !== p.enrollment_id) throw new PermanentJobError('deneme cevabı bulunamadı ya da kayda ait değil', 'OGR-JOB-147');
  if (r.solution_analysis_id) {
    await setStatus(ctx, p.upload_ids, 'ready');
    return { analysisId: r.solution_analysis_id, verdict: 'reused', reused: true, rawReused: false, fileIds: [], issues: [], embedded: false };
  }
  const ids = p.upload_ids.length > 0 ? p.upload_ids.slice(0, MAX_DIAGNOSIS_UPLOADS) : r.page_upload_id ? [r.page_upload_id] : [];
  const ups = ids.length
    ? ((await ctx.db.query(`select id, student_id, owner_id, kind, storage_path, mime, status, anthropic_file_id from public.uploads where id = any($1::uuid[])`, [ids])).rows as unknown as UploadRow[])
    : [];
  const byId = new Map(ups.map((u) => [String(u.id), u]));
  const uploads = ids.map((id) => byId.get(id)).filter((u): u is UploadRow => Boolean(u));
  if (uploads.length !== ids.length || uploads.some((u) => String(u.student_id) !== r.student_id)) {
    throw new PermanentJobError('yüklemeler bulunamadı ya da bu öğrencinin değil', 'OGR-JOB-142');
  }
  const text = (p.how_far_text ?? r.how_far_text)?.trim() || null;
  try {
    return await diagnose(p, ctx, r, uploads, text);
  } catch (err) {
    const reading = isReadingFailure(err);
    const last = ctx.job.retryCount >= RETRY_LIMIT;
    if (!reading && !(err instanceof PermanentJobError) && !last) throw err;
    const c = classifyError(err);
    await ctx.db
      .query(`select app.audit_event('diagnosis.failed', 'public.exam_responses', $1, $2::jsonb)`, [
        r.id,
        JSON.stringify({ exam_response_id: r.id, session_id: r.session_id, upload_ids: p.upload_ids, enrollment_id: r.enrollment_id, failure: reading ? 'reading' : 'processing', reason: c.code }),
      ])
      .catch(() => undefined);
    await setStatus(ctx, p.upload_ids, 'failed').catch(() => undefined);
    throw err instanceof PermanentJobError ? err : new PermanentJobError(`deneme teşhisi düştü: ${(err as Error).message}`, reading ? 'OGR-JOB-143' : 'OGR-JOB-145');
  }
}

async function diagnose(p: DiagnosisRunPayload, ctx: JobContext, r: ResponseRow, uploads: UploadRow[], text: string | null): Promise<DiagnosisRunResult> {
  const prevRaw = (
    await ctx.db.query(`select diff from audit.events where action = $1 and row_id = $2 and diff ->> 'exam_response_id' = $2 order by created_at desc, id desc limit 1`, [RAW_ACTION, r.id])
  ).rows[0]?.diff as { data: SolutionDiagnosis; model: string; cost_usd: number; prompt_version: string; file_ids: string[] } | undefined;
  let stored = prevRaw && prevRaw.data ? prevRaw : null;
  const rawReused = stored !== null;
  if (!stored) {
    const gateway = await ctx.gateway();
    const uploader = fileUploaderFor(gateway, ctx.storage);
    const answers = await stashGet<AnswerRow[]>(ctx.db, r.session_id, 'answers');
    const marks = answers?.find((a) => a.no === r.no) ?? null;
    const photos = p.upload_ids.length;
    const c = examContextFor(r, marks, photos > 0, text);
    const prompt = await systemPrompt(ctx.db, 'solution_diagnosis');
    const system = r.course_id ? (await buildPromptSystem(ctx.db, { product: prompt.text, studentId: r.student_id, courseId: r.course_id })).system : { product: prompt.text };
    const call = (fileIds: string[]) => {
      const blocks: UserBlocks = uploads.map((u, i) =>
        u.mime === 'application/pdf' || u.kind === 'pdf'
          ? { type: 'document' as const, source: { type: 'file' as const, file_id: fileIds[i]! }, title: `Sayfa ${i + 1}` }
          : { type: 'image' as const, source: { type: 'file' as const, file_id: fileIds[i]! } },
      );
      blocks.push({ type: 'text', text: examDiagnosisText(c, r, text, uploads.length) });
      return gateway.call('solution_diagnosis', {
        system,
        user: blocks,
        turn: { now: ctx.now() },
        promptVersion: prompt.version,
        studentRef: r.public_ref,
        ref: { table: 'exam_responses', id: r.id },
        purpose: 'diagnosis.run',
        signal: ctx.signal,
      });
    };
    let fileIds = uploads.length ? await ensureFiles(ctx.db, uploader, uploads, false) : [];
    let res: Awaited<ReturnType<typeof call>>;
    try {
      res = await call(fileIds);
    } catch (err) {
      // süresi dolmuş (90 gün) ya da silinmiş Files kimliği: yüklemeler yeniden çıkarılır, çağrı bir kez yinelenir (diagnosis.ts ile aynı)
      if (!isMissingFileError(err) || uploads.length === 0) throw err;
      ctx.log.warn('Files API kimliği yok ya da süresi dolmuş; yeniden yükleniyor', { exam_response_id: r.id });
      fileIds = await ensureFiles(ctx.db, uploader, uploads, true);
      res = await call(fileIds);
    }
    stored = { data: res.data as SolutionDiagnosis, model: res.model, cost_usd: res.costUsd, prompt_version: prompt.version, file_ids: fileIds };
    await ctx.db.query(`select app.audit_event($1, 'public.exam_responses', $2, $3::jsonb)`, [
      RAW_ACTION,
      r.id,
      JSON.stringify({ exam_response_id: r.id, session_id: r.session_id, upload_ids: p.upload_ids, enrollment_id: r.enrollment_id, ...stored }),
    ]);
  }
  const idx = await loadCurriculumIndex(ctx.db, r.curriculum_id);
  const { diagnosis: d, issues, dropped } = validateDiagnosis(stored.data, idx);
  const oneLine = diagnosisOneLine(d);
  const embedding = await embedDiagnosisText(`${d.question_text}\n${d.student_work_text}\n${d.why_tr}`).catch(() => null);
  const applied = await ctx.db.query('select public.apply_diagnosis($1::jsonb) as id', [
    JSON.stringify({
      enrollment_id: r.enrollment_id,
      exam_response_id: r.id,
      upload_ids: p.upload_ids,
      verdict: d.verdict,
      error_cause: d.error_cause,
      failing_step_no: d.failing_step_no,
      skill_ids: d.skill_ids,
      misconception_tags: d.misconception_tags,
      proposed_subskill: proposalForApply(d.proposed_subskill),
      // telifli kök öğrenciye/veliye açık tabloya yazılmaz (v_exam_questions_student maskesiyle aynı kural)
      question_text: r.is_copyrighted ? null : d.question_text,
      student_work_text: d.student_work_text,
      confidence: d.confidence,
      quote: d.why_tr,
      model: stored.model,
      cost_usd: rawReused ? 0 : stored.cost_usd,
      analysis: {
        why_tr: d.why_tr,
        one_line: oneLine,
        steps: d.student_steps,
        reference_steps: d.reference_solution_steps,
        style_hint: d.style_hint,
        confidence: d.confidence,
        proposed_subskill: d.proposed_subskill,
        skill_order: d.skill_ids,
        file_ids: stored.file_ids,
        prompt_version: stored.prompt_version,
        context: { kind: 'exam', session_id: r.session_id, question_no: r.no, how_far_text: text },
        validation: { issues, dropped },
      },
      ...(embedding ? { embedding } : {}),
    }),
  ]);
  await setStatus(ctx, p.upload_ids, 'ready');
  return { analysisId: String(applied.rows[0]?.id), verdict: d.verdict, reused: false, rawReused, fileIds: stored.file_ids, issues, embedded: embedding !== null };
}
