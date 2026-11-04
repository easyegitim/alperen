/**
 * `upload.intake` — Yükle ekranından gelen sayfalar (docs/PLAN-v2.md §13 "Yükle"). Web, yüklemeleri Storage'a ve
 * `uploads` satırlarına yazar, sonra öğrenci oturumundaki RPC (submit_upload) bu işi kuyruğa atar:
 * {upload_ids[], kind: 'own_work' | 'school_exam', student_id, enrollment_id}.
 *
 *   own_work    → `diagnosis.run` {upload_ids, enrollment_id} (tekil anahtar: ilk yükleme).
 *   school_exam → eski yol (web P2'de doğrudan submit_exam_upload çağırır): submit_exam_upload ile aynı kayıt —
 *                 exams(kind='deneme', source='uploaded', is_copyrighted, status='processing') + exam_sessions(mode=
 *                 'uploaded', status='grading', upload_ids, progress.stage='classify') — sayfa bağlantısı audit.events
 *                 'exam.upload_intake' satırında, yüklemeler 'processing', `exam.analyse` kuyruğa atılır ve Bugün'e
 *                 "Denemeni inceliyorum" kartı (copy_key = upload:<ilk yükleme>; öneri motoru süren oturumdan aynı kartı
 *                 kurar).
 * İkinci çalıştırma (yeniden deneme) yeni sınav açmaz: aynı ilk yükleme için audit satırı varsa onu döner. Sınav, oturum
 * ve audit bağı tek SQL deyiminde (CTE) yazılır: iş arada düşerse yarım kayıt kalmaz.
 */
import { z } from 'zod';
import type { Db } from '../db.js';
import { refKey, UPLOAD_CARD } from '../suggestions/rules.js';
import { MAX_DIAGNOSIS_UPLOADS, MAX_SCHOOL_EXAM_UPLOADS, writeUploadCard } from './diagnosis.js';
import { PermanentJobError } from './errors.js';
import { uuid } from './schemas.js';
import type { JobDefinition } from './types.js';

export const UPLOAD_KINDS = ['own_work', 'school_exam'] as const;
export type UploadIntakeKind = (typeof UPLOAD_KINDS)[number];

/** Sayfa sınırı türe göre: Kendi çalışmam 4 (diagnosis.run), Okul denemesi 40 (submit_upload ve web aynı). */
const payload = z
  .object({
    upload_ids: z.array(uuid).min(1).max(MAX_SCHOOL_EXAM_UPLOADS),
    kind: z.enum(UPLOAD_KINDS),
    student_id: uuid,
    enrollment_id: uuid,
  })
  .refine((p) => p.kind !== 'own_work' || p.upload_ids.length <= MAX_DIAGNOSIS_UPLOADS, {
    message: `own_work en çok ${MAX_DIAGNOSIS_UPLOADS} sayfa`,
    path: ['upload_ids'],
  });
export type UploadIntakePayload = z.infer<typeof payload>;

export interface UploadIntakeResult {
  kind: UploadIntakeKind;
  enqueued: string[];
  examId: string | null;
  sessionId: string | null;
  reused: boolean;
}

/** Bekleyen deneme kartı (öneri motoru aynı metni 'analysing' oturumdan yeniden kurar; copy_key = upload:<ilk yükleme>). */
export const SCHOOL_EXAM_CARD = UPLOAD_CARD.pending;

/** "Okul denemesi · 3 Kas" (Europe/Istanbul). */
export function schoolExamTitle(now: Date): string {
  const d = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short' }).format(now);
  return `Okul denemesi · ${d}`;
}

async function existingIntake(db: Db, firstUpload: string): Promise<{ examId: string; sessionId: string | null } | null> {
  const r = await db.query(
    `select diff ->> 'exam_id' as exam_id, diff ->> 'session_id' as session_id from audit.events
      where action = 'exam.upload_intake' and row_id = $1 order by created_at desc limit 1`,
    [firstUpload],
  );
  const row = r.rows[0];
  return row?.exam_id ? { examId: String(row.exam_id), sessionId: row.session_id ? String(row.session_id) : null } : null;
}

export const uploadIntakeJob: JobDefinition<UploadIntakePayload, UploadIntakeResult> = {
  name: 'upload.intake',
  description: 'Yükleme girişi: Kendi çalışmam → diagnosis.run; Okul denemesi → deneme kaydı + exam.analyse + Bugün kartı.',
  process: 'worker',
  payload,
  concurrency: 2,
  retry: { retryLimit: 3, retryDelay: 15, retryBackoff: true, retryDelayMax: 300, expireInSeconds: 120, deleteAfterSeconds: 604_800 },
  handler: async (p, ctx) => {
    const e = (await ctx.db.query('select id, student_id, curriculum_id, course_id from public.enrollments where id = $1::uuid', [p.enrollment_id])).rows[0];
    if (!e || String(e.student_id) !== p.student_id) throw new PermanentJobError('kayıt bulunamadı ya da öğrenciye ait değil', 'OGR-JOB-144');
    const ups = (await ctx.db.query('select id, student_id, owner_id from public.uploads where id = any($1::uuid[])', [p.upload_ids])).rows;
    if (ups.length !== new Set(p.upload_ids).size || ups.some((u) => String(u.student_id) !== p.student_id)) {
      throw new PermanentJobError('yüklemeler bulunamadı ya da bu öğrencinin değil', 'OGR-JOB-142');
    }
    const first = p.upload_ids[0]!;

    if (p.kind === 'own_work') {
      await ctx.enqueue('diagnosis.run', { upload_ids: p.upload_ids, enrollment_id: p.enrollment_id }, { singletonKey: `diagnosis:${first}` });
      return { kind: p.kind, enqueued: ['diagnosis.run'], examId: null, sessionId: null, reused: false };
    }

    const prev = await existingIntake(ctx.db, first);
    let examId: string;
    let sessionId: string;
    if (prev) {
      examId = prev.examId;
      if (!prev.sessionId) throw new PermanentJobError('eski deneme kaydının oturumu yok', 'OGR-JOB-144');
      sessionId = prev.sessionId;
    } else {
      const owner = String(ups.find((u) => String(u.id) === first)?.owner_id ?? ups[0]!.owner_id);
      // tek deyim = tek işlem: exams → exam_sessions → audit bağı (yeniden denemenin anahtarı) birlikte yazılır ya da hiç
      const row = (
        await ctx.db.query(
          `with ex as (
             insert into public.exams (course_id, curriculum_id, created_by, kind, source, title, is_copyrighted, status)
             values ($1::uuid, $2::uuid, $3::uuid, 'deneme', 'uploaded', $4, true, 'processing') returning id
           ), se as (
             insert into public.exam_sessions (exam_id, enrollment_id, mode, status, upload_ids, progress)
             select ex.id, $5::uuid, 'uploaded', 'grading', $8::uuid[],
                    jsonb_build_object('stage', 'classify', 'pages_total', cardinality($8::uuid[]), 'pages_done', 0, 'updated_at', now())
               from ex returning id, exam_id
           ), au as (
             select app.audit_event('exam.upload_intake', 'uploads', $6,
                      jsonb_build_object('exam_id', se.exam_id, 'session_id', se.id, 'upload_ids', $7::jsonb, 'enrollment_id', $5::text))
               from se
           )
           select se.exam_id, se.id as session_id, (select count(*) from au) as linked from se`,
          [e.course_id ?? null, e.curriculum_id, owner, schoolExamTitle(ctx.now()), p.enrollment_id, first, JSON.stringify(p.upload_ids), p.upload_ids],
        )
      ).rows[0];
      if (!row || Number(row.linked) !== 1) throw new Error('deneme kaydı yazılamadı');
      examId = String(row.exam_id);
      sessionId = String(row.session_id);
    }
    await ctx.db.query(`update public.uploads set status = 'processing' where id = any($1::uuid[]) and status = 'stored'`, [p.upload_ids]);
    await ctx.enqueue(
      'exam.analyse',
      { session_id: sessionId, exam_id: examId, enrollment_id: p.enrollment_id, student_id: p.student_id, upload_ids: p.upload_ids },
      { singletonKey: `exam:${sessionId}`, singletonSeconds: 3600 },
    );
    await writeUploadCard(
      ctx.db,
      p.student_id,
      {
        ref: refKey('upload', first),
        state: 'pending',
        analysisId: null,
        sessionId,
        examId,
        uploadId: first,
        uploadIds: p.upload_ids,
        enrollmentId: p.enrollment_id,
        verdict: null,
        at: ctx.now().toISOString(),
        net: null,
      },
      ctx.now(),
    );
    return { kind: p.kind, enqueued: ['exam.analyse'], examId, sessionId, reused: Boolean(prev) };
  },
};
