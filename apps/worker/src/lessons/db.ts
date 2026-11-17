/**
 * Ders hattının veritabanı yolu (supabase 0039–0041). Yazımlar RPC'lerden geçer (`lesson_set_progress`,
 * `write_lesson_transcript`, `write_lesson_analysis`, `apply_lesson_claims`, `lesson_mark_media_deleted`); worker
 * güvenilir çağırandır (JWT'siz doğrudan bağlantı, app.is_trusted()). Okumalar düz SQL'dir.
 */
import type { Db } from '../db.js';

export const LESSON_BUCKET = 'lessons';

export type LessonStage = 'prepare' | 'stt' | 'label' | 'analyse' | 'apply' | 'done' | 'failed';
export type Counters = Record<string, number | string | boolean | null>;

export interface UploadRow {
  id: string;
  kind: string;
  storage_path: string;
  mime: string | null;
  owner_id: string;
}

export interface LessonRow {
  id: string;
  /** Birebir derste kayıt; boşsa sınıf dersi. */
  enrollment_id: string | null;
  /** Dersin dersi (birebir derste kaydın dersi). */
  course_id: string | null;
  instructor_id: string | null;
  held_at: string;
  title: string | null;
  duration_sec: number | null;
  duration_min: number | null;
  status: string;
  student_visible: boolean;
  auto_apply_threshold: number;
  audio_path: string | null;
  frames_count: number | null;
  /** Yüklenen transkript dosyası içe aktarılıp Storage'dan silindiyse zamanı. */
  transcript_deleted_at: string | null;
  progress: Record<string, unknown>;
  upload: UploadRow | null;
  transcript_upload: UploadRow | null;
  curriculum_id: string | null;
  course_code: string | null;
  course_title: string | null;
}

export interface LessonStudent {
  student_id: string;
  public_ref: string;
  enrollment_id: string | null;
  profile_id: string | null;
}

export interface TranscriptSegment {
  t0: number;
  t1: number;
  speaker: 'ÖĞRENCİ' | 'EĞİTMEN' | 'DİĞER' | null;
  text: string;
}

export interface TranscriptRow {
  segments: TranscriptSegment[];
  language: string;
  provider: string;
  labeled: boolean;
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

function upload(v: unknown): UploadRow | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return { id: String(o.id), kind: String(o.kind), storage_path: String(o.storage_path), mime: str(o.mime), owner_id: String(o.owner_id) };
}

export async function loadLesson(db: Db, lessonId: string): Promise<LessonRow | null> {
  const r = await db.query(
    `select l.id, l.enrollment_id, coalesce(l.course_id, e.course_id) as course_id, l.instructor_id, l.held_at, l.title, l.duration_sec, l.duration_min, l.status,
            l.student_visible, l.auto_apply_threshold::float8 as auto_apply_threshold, l.audio_path, l.frames_count, l.transcript_deleted_at, l.progress,
            (select to_jsonb(u) from (select u.id, u.kind, u.storage_path, u.mime, u.owner_id from public.uploads u where u.id = l.upload_id) u) as upload,
            (select to_jsonb(u) from (select u.id, u.kind, u.storage_path, u.mime, u.owner_id from public.uploads u where u.id = l.transcript_upload_id) u) as transcript_upload,
            coalesce(e.curriculum_id, c.curriculum_id) as curriculum_id, c.code as course_code, c.title as course_title
       from public.lessons l
       left join public.enrollments e on e.id = l.enrollment_id
       left join public.courses c on c.id = coalesce(l.course_id, e.course_id)
      where l.id = $1::uuid`,
    [lessonId],
  );
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: String(x.id),
    enrollment_id: str(x.enrollment_id),
    course_id: str(x.course_id),
    instructor_id: str(x.instructor_id),
    held_at: iso(x.held_at),
    title: str(x.title),
    duration_sec: num(x.duration_sec),
    duration_min: num(x.duration_min),
    status: String(x.status),
    student_visible: x.student_visible === true,
    auto_apply_threshold: Number(x.auto_apply_threshold ?? 0.8),
    audio_path: str(x.audio_path),
    frames_count: num(x.frames_count),
    transcript_deleted_at: x.transcript_deleted_at ? iso(x.transcript_deleted_at) : null,
    progress: (x.progress && typeof x.progress === 'object' ? x.progress : {}) as Record<string, unknown>,
    upload: upload(x.upload),
    transcript_upload: upload(x.transcript_upload),
    curriculum_id: str(x.curriculum_id),
    course_code: str(x.course_code),
    course_title: str(x.course_title),
  };
}

/**
 * Dersin öğrencileri: kapsam kuralı tek yerde, `app.lesson_students` (0039): birebir derste kaydın öğrencisi; sınıf
 * dersinde derse etkin kayıtlı VE dersi veren eğitmene owner bağlı öğrenciler (ortak derste başka eğitmenlerin öğrencileri
 * kapsam dışı: hafıza, öneri, ad temizliği).
 */
export async function lessonStudents(db: Db, lesson: Pick<LessonRow, 'id'>): Promise<LessonStudent[]> {
  const r = await db.query(
    `select distinct on (s.id) s.id as student_id, s.public_ref, s.profile_id, e.id as enrollment_id
       from public.lessons l
       cross join lateral unnest(app.lesson_students(l.id)) as st (student_id)
       join public.students s on s.id = st.student_id
       left join public.enrollments e
         on e.student_id = s.id and (e.id = l.enrollment_id or (l.enrollment_id is null and e.course_id = l.course_id and e.status = 'active'))
      where l.id = $1::uuid
      order by s.id, e.started_at desc nulls last`,
    [lesson.id],
  );
  return r.rows.map((x) => ({ student_id: String(x.student_id), public_ref: String(x.public_ref), enrollment_id: str(x.enrollment_id), profile_id: str(x.profile_id) }));
}

export async function setProgress(db: Db, lessonId: string, stage: LessonStage, counters: Counters = {}): Promise<void> {
  await db.query('select public.lesson_set_progress($1::uuid, $2, $3::jsonb)', [lessonId, stage, JSON.stringify(counters)]);
}

/** Hata: ders ve yüklemeler failed, kısa Türkçe neden ilerlemede (eğitmen görür). */
export async function failLesson(db: Db, lessonId: string, error: string, counters: Counters = {}): Promise<void> {
  await setProgress(db, lessonId, 'failed', { ...counters, error: error.slice(0, 300) });
}

export async function writeTranscript(db: Db, lessonId: string, segments: TranscriptSegment[], language: string, provider: string): Promise<{ segments: number; labeled: boolean }> {
  const r = await db.query('select public.write_lesson_transcript($1::uuid, $2::jsonb, $3, $4) as r', [lessonId, JSON.stringify(segments), language, provider]);
  const out = (r.rows[0]?.r ?? {}) as { segments?: number; labeled?: boolean };
  return { segments: Number(out.segments ?? segments.length), labeled: out.labeled === true };
}

export async function readTranscript(db: Db, lessonId: string): Promise<TranscriptRow | null> {
  const r = await db.query('select segments, language, provider, labeled from public.lesson_transcripts where lesson_id = $1::uuid', [lessonId]);
  const x = r.rows[0];
  if (!x) return null;
  const segs = (Array.isArray(x.segments) ? x.segments : []) as Record<string, unknown>[];
  return {
    segments: segs.map((s) => ({
      t0: Number(s.t0 ?? 0),
      t1: Number(s.t1 ?? s.t0 ?? 0),
      speaker: s.speaker === 'ÖĞRENCİ' || s.speaker === 'EĞİTMEN' || s.speaker === 'DİĞER' ? s.speaker : null,
      text: String(s.text ?? ''),
    })),
    language: String(x.language ?? 'tr'),
    provider: String(x.provider ?? 'groq'),
    labeled: x.labeled === true,
  };
}

export type LessonMedia = 'video' | 'audio' | 'frames' | 'transcript_file';

export async function markMediaDeleted(db: Db, lessonId: string, media: LessonMedia): Promise<void> {
  await db.query('select public.lesson_mark_media_deleted($1::uuid, $2)', [lessonId, media]);
}

export interface OpenMisconceptionRow {
  id: string;
  tag: string | null;
  skill_id: string | null;
  text: string;
}

/** Birebir dersin açık yanılgıları (önceki yanılgı takibi; en yeni 20). */
export async function openMisconceptions(db: Db, enrollmentId: string | null): Promise<OpenMisconceptionRow[]> {
  if (!enrollmentId) return [];
  const r = await db.query(
    `select id, tag, skill_id, text_instructor from public.misconceptions
      where enrollment_id = $1::uuid and status = 'open' order by last_seen desc, id limit 20`,
    [enrollmentId],
  );
  return r.rows.map((x) => ({ id: String(x.id), tag: str(x.tag), skill_id: str(x.skill_id), text: String(x.text_instructor ?? '') }));
}

/** Aynı kaydın (ya da sınıf dersinin) bir önceki ONAYLI analizinin eğitmene sonraki adımı (taslak kullanılmaz). */
export async function previousNextStep(db: Db, lesson: LessonRow): Promise<string | null> {
  const r = await db.query(
    `select la.analysis #>> '{next_step,for_instructor}' as s
       from public.lesson_analyses la join public.lessons l on l.id = la.lesson_id
      where la.status in ('approved', 'corrected') and l.id <> $1::uuid
        and ((l.enrollment_id is not null and l.enrollment_id = $2::uuid)
             or (l.enrollment_id is null and $2::uuid is null and l.course_id = $3::uuid and l.instructor_id is not distinct from $5::uuid))
        and l.held_at <= $4::timestamptz
      order by l.held_at desc, la.version desc limit 1`,
    [lesson.id, lesson.enrollment_id, lesson.course_id, lesson.held_at, lesson.instructor_id],
  );
  return str(r.rows[0]?.s);
}

/** Yaprak kazanımlar (analiz doğrulaması: model yalnız bunları kullanabilir). */
export async function leafSkills(db: Db, curriculumId: string): Promise<Set<string>> {
  const r = await db.query('select id from public.skills where curriculum_id = $1::uuid and is_leaf', [curriculumId]);
  return new Set(r.rows.map((x) => String(x.id)));
}

/**
 * Eğitmenlere uygulama içi bildirim: incelemenizi bekleyen iddialar (aynı analiz için bir kez). Birebir derste dersi
 * veren + öğrencinin owner eğitmenleri; sınıf dersinde yalnız dersi veren (dersi başka eğitmen görmez: lesson_staff_view).
 */
export async function notifyInstructors(db: Db, lesson: LessonRow, analysisId: string, pending: number): Promise<number> {
  if (pending <= 0) return 0;
  const title = lesson.title ? `Ders analizi hazır: ${lesson.title}` : 'Ders analizi hazır';
  const body = `${pending} iddia incelemenizi bekliyor; güveni eşiğin üstündekiler dossier'e işlendi.`;
  const r = await db.query(
    `with rcpt as (
       select $1::uuid as id where $1::uuid is not null
       union
       select il.instructor_id from public.instructor_links il
        where il.role = 'owner' and il.student_id in (
          select e.student_id from public.enrollments e where e.id = $2::uuid))
     insert into public.notifications (recipient_id, kind, title, body, payload, channels)
     select rcpt.id, 'lesson_review', $3, $4,
            jsonb_build_object('lesson_id', $5::text, 'analysis_id', $6::text, 'pending', $7::int, 'url', '/egitmen/dersler/' || $5::text), '{in_app}'
       from rcpt
      where not exists (select 1 from public.notifications n
                         where n.recipient_id = rcpt.id and n.kind = 'lesson_review' and n.payload ->> 'analysis_id' = $6::text)
     returning id`,
    [lesson.instructor_id, lesson.enrollment_id, title, body, lesson.id, analysisId, pending],
  );
  return r.rows.length;
}
