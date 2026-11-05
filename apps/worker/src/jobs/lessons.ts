/**
 * P5 ders hattı (docs/PLAN-v2.md §9; supabase 0039–0041). register_lesson (eğitmen, TUS yüklemesinden) 'lesson.prepare'
 * atar; her aşama bir sonrakini kuyruğa atar ve ilerlemeyi lesson_set_progress ile yazar (eğitmen ekranı okur):
 *
 *   lesson.prepare   pipelines/ders servisi /prepare: ffmpeg 16 kHz mono WAV + ≤ 30 sahne karesi (JPEG ≤ 1280 px) →
 *                    Storage 'lessons/<sahip>/<ders>/…' (audio_path, frames_count, duration_sec, media_prefix). Hazır
 *                    transkript yüklendiyse (transkript dosyası ya da video + transkript) STT atlanır: dosya ayrıştırılır
 *                    (JSON/VTT/SRT/metin) → ad temizliği → write_lesson_transcript(provider 'upload') → dosya Storage'dan
 *                    silinir → lesson.label.
 *   lesson.stt       servis /stt (Groq Whisper large-v3-turbo; 25 MB parçalama; anahtarsızken OGRENMEN_STT=fake) →
 *                    ad temizliği (düz ad veritabanına hiç yazılmaz) → write_lesson_transcript (konuşmacısız) →
 *                    çıkarılan ses Storage'dan silinir (lesson_mark_media_deleted).
 *   lesson.label     ad temizliği (packages/pii; öğrenci/eğitmen/veli ad-token hash'leri, kapalı başarısızlık) →
 *                    speaker_label (Sonnet · low · düşünme kapalı) 10 dakikalık pencerelerde ÖĞRENCİ/EĞİTMEN →
 *                    write_lesson_transcript (temiz + etiketli).
 *   lesson.analyse   lesson_analysis (Opus · high): ≤ 30 kare (görsel) + transkript + dossier (birebir) + açık yanılgılar
 *                    + önceki onaylı sonraki adım → bağlam denetimi (alıntılar transkriptte, yapraklar, süre, ad, öğrenci
 *                    metinleri; gerekirse bir onarım turu) → write_lesson_analysis → apply_lesson_claims (güven ≥ eşik
 *                    → observations(kind='lesson') BKT; altı eğitmen incelemesinde) → eğitmene bildirim (bekleyen varsa)
 *                    → öğrencilerin Bugün kartları (suggestions.refresh; lesson_review onaylı analizden) → done → sahne
 *                    kareleri Storage'dan silinir (yalnız analiz içindir). Yeniden deneme (iş süresi, bağlantı) analizi
 *                    transkriptten yeniyse modeli yeniden çağırmaz, uygulamadan sürer; yeni sürüm yazılırsa eskisinin
 *                    uygulanmış iddiaları geri alınır (write_lesson_analysis): kanıt iki kez sayılmaz.
 *   lesson.retention gece 04:15 (schedules.ts SCHEDULES; pg_cron sahibiyse 0040'taki cron eşleniği): önce takılan
 *                    dersler (processing, ilerlemesi STALE_HOURS saattir yazılmamış, kuyrukta işi yok: işçi son denemede
 *                    öldü) failed olur ("Yeniden dene" açılır); sonra süresi dolan ham video (retain_until, 90 gün),
 *                    kalan çıkarılmış sesler ve kareler (düşen ya da takılan ders), içe aktarılmış transkript dosyaları
 *                    Storage'dan silinir. Liste sınırı dolarsa bir dakika sonra 'more' devamı atılır.
 *   memory.apply     {source: 'lesson'} (apply_lesson_claims atar): /memories/courses/<kod>.md ders bölümü.
 *
 * Hata: kalıcı hata (bozuk/sessiz kayıt, ad temizliği, şema) ya da son deneme → lesson_set_progress('failed', {error})
 * (ders ve yüklemeler failed; eğitmen görür ve "Yeniden dene" ile retry_lesson'ı çağırabilir) → türetilmiş medya
 * ('<sahip>/<ders>/audio.wav', 'frames/') hemen silinir. Geçici hata (servis kapalı, 429/5xx) pg-boss ile yeniden denenir.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { z } from 'zod';
import type { LessonAnalysis, Transcript } from '@ogrenmen/contracts';
import { buildPromptSystem, classifyError, ParseError, RefusalError, renderCourseBlock, type Gateway, type SystemParts } from '@ogrenmen/llm';
import { hms, labelWindows, lessonAnalysisUserText, speakerLabelUserText, type LessonKind } from '@ogrenmen/prompts';
import { checkLessonAnalysis, repairNote, settleStudentTexts } from '../lessons/analysis.js';
import {
  failLesson,
  leafSkills,
  LESSON_BUCKET,
  lessonStudents,
  loadLesson,
  markMediaDeleted,
  notifyInstructors,
  openMisconceptions,
  previousNextStep,
  readTranscript,
  setProgress,
  writeTranscript,
  type Counters,
  type LessonMedia,
  type LessonRow,
  type LessonStage,
  type TranscriptSegment,
} from '../lessons/db.js';
import { applyLessonMemory, type MemoryApplyResult } from '../lessons/memory.js';
import { assertNoNames, lessonNameHashes, scrubText, type NameHashes } from '../lessons/names.js';
import { asJobError, lessonService, type LessonService, type ServiceHealth } from '../lessons/service.js';
import { alignLabels, parseTranscriptFile } from '../lessons/transcript.js';
import { systemPrompt } from '../prompts.js';
import type { StorageLike } from '../storage.js';
import { debounced } from './dedupe.js';
import { PermanentJobError } from './errors.js';
import { uuid } from './schemas.js';
import type { AnyJobDefinition, JobContext, JobDefinition, QueuePolicy } from './types.js';

export const LESSON_QUEUES = ['lesson.prepare', 'lesson.stt', 'lesson.label', 'lesson.analyse', 'lesson.retention', 'memory.apply'] as const;
/** Sınıf dersinde analiz şemasının istediği anonim öğrenci kimliği (tek öğrenciye ait değil). */
export const CLASS_STUDENT_REF = 's_aaaaaaaaaaaa';
export const MAX_FRAMES = 30;
/** Takılan ders eşiği (saat): bu süredir ilerlemesi yazılmayan processing ders düşmüş sayılır (retry_lesson ile aynı). */
export const STALE_HOURS = 2;
/** Analize giden kareler: kare başına ve toplam base64 bütçesi (Claude API istek sınırı 32 MB). */
export const FRAME_MAX_BYTES = 1024 * 1024;
export const FRAMES_BASE64_BUDGET = 20 * 1024 * 1024;

const MEDIA_RETRY: QueuePolicy = { retryLimit: 2, retryDelay: 60, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 3600, deleteAfterSeconds: 7 * 86_400 };
const LLM_RETRY: QueuePolicy = { retryLimit: 2, retryDelay: 60, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 1800, deleteAfterSeconds: 7 * 86_400 };

const frameRef = z.object({ path: z.string().min(3).max(512), t: z.string().regex(/^\d{2}:\d{2}:\d{2}$/), t_sec: z.number().min(0) });
export type FrameRef = z.infer<typeof frameRef>;
const frames = z.array(frameRef).max(MAX_FRAMES).default([]);

const preparePayload = z
  .object({ lesson_id: uuid, upload_id: uuid.nullish(), transcript_upload_id: uuid.nullish(), upload_kind: z.string().max(32).nullish() })
  .passthrough();
const sttPayload = z.object({ lesson_id: uuid, audio_path: z.string().min(3).max(512).nullish(), frames }).passthrough();
const stagePayload = z.object({ lesson_id: uuid, frames }).passthrough();
const retentionPayload = z.object({ limit: z.number().int().min(1).max(1000).default(100), reason: z.string().max(64).nullish() }).passthrough();
const memoryPayload = z
  .object({
    source: z.string().min(1).max(32),
    lesson_id: uuid.optional(),
    course_id: uuid.nullish(),
    course_code: z.string().max(120).nullish(),
    path: z.string().max(200).optional(),
    student_ids: z.array(uuid).max(500).optional(),
    claim_ids: z.array(uuid).max(5000).optional(),
  })
  .passthrough();

export interface StageResult {
  lesson_id: string;
  stage: LessonStage | 'skipped';
  next?: string | null;
  counters?: Counters;
  reason?: string;
}

// --- ortak --------------------------------------------------------------------------------------------------------------

function storageOrNull(ctx: JobContext): StorageLike | null {
  try {
    return ctx.storage();
  } catch {
    return null;
  }
}

function requireStorage(ctx: JobContext): StorageLike {
  const s = storageOrNull(ctx);
  if (!s) throw new PermanentJobError('Storage yapılandırılmadı: ders dosyaları okunamaz', 'OGR-JOB-180');
  return s;
}

async function requireLesson(ctx: JobContext, lessonId: string): Promise<LessonRow> {
  const l = await loadLesson(ctx.db, lessonId);
  if (!l) throw new PermanentJobError(`ders bulunamadı: ${lessonId}`, 'OGR-JOB-180');
  return l;
}

/** Aynı dersin aynı aşamasının yeniden denemesi bir sonraki işi iki kez atmasın. */
async function chain(ctx: JobContext, name: string, data: object, lessonId: string): Promise<string | null> {
  return ctx.enqueue(name, data, { singletonKey: `${name}:${lessonId}`, singletonSeconds: 120 });
}

/** Kullanıcıya (eğitmen) gidecek kısa Türkçe neden. */
function failureText(stage: LessonStage, err: unknown): string {
  const label: Partial<Record<LessonStage, string>> = {
    prepare: 'Kayıt hazırlanamadı',
    stt: 'Ses metne çevrilemedi',
    label: 'Konuşmacılar ayrılamadı',
    analyse: 'Ders analiz edilemedi',
    apply: 'İddialar uygulanamadı',
  };
  const msg = err instanceof Error ? err.message : String(err);
  return `${label[stage] ?? 'Ders işlenemedi'}: ${msg}`.slice(0, 300);
}

/** Kare yolları: servis 'frame-01.jpg' … sırayla adlandırır (≤ MAX_FRAMES); olmayan yolu silmek sessizdir. */
export function framePaths(prefix: string): string[] {
  return Array.from({ length: MAX_FRAMES }, (_, i) => `${prefix}/frames/frame-${String(i + 1).padStart(2, '0')}.jpg`);
}

/** Dersin türetilmiş medyasının klasörü ('<sahip>/<ders>'); ham yükleme yoksa null. */
function lessonPrefix(lesson: LessonRow): string | null {
  const p = lesson.progress.media_prefix;
  if (typeof p === 'string' && /^[^/]+\/[^/]+$/.test(p) && !p.split('/').some((x) => x === '.' || x === '..')) return p;
  return lesson.upload ? derivedPrefix(lesson.upload.storage_path, lesson.id) : null;
}

/** Türetilmiş medyayı (çıkarılan ses + kareler) siler ve işaretler; düşmez (gece işi kalanı toplar). */
async function removeDerived(ctx: JobContext, lesson: LessonRow, what: { audio?: boolean; frames?: boolean }): Promise<void> {
  const storage = storageOrNull(ctx);
  const prefix = lessonPrefix(lesson);
  if (!storage?.remove || !prefix) return;
  const jobs: [LessonMedia, string[]][] = [];
  if (what.audio) jobs.push(['audio', [...new Set([`${prefix}/audio.wav`, ...(lesson.audio_path ? [lesson.audio_path] : [])])]]);
  if (what.frames) jobs.push(['frames', framePaths(prefix)]);
  for (const [media, paths] of jobs) {
    try {
      await storage.remove(LESSON_BUCKET, paths);
      await markMediaDeleted(ctx.db, lesson.id, media);
    } catch (err) {
      ctx.log.warn('ders medyası silinemedi; gece işine kaldı', { lesson: lesson.id, media, error: (err as Error).message });
    }
  }
}

/**
 * Aşama gövdesi: kalıcı hata ya da son denemede ders failed olur, türetilmiş medya (ses, kareler) silinir ve iş kalıcı
 * hatayla biter (dead_letter); geçici hata pg-boss'a bırakılır.
 */
async function guarded<R>(ctx: JobContext, def: { retry: QueuePolicy }, lesson: LessonRow, stage: LessonStage, fn: () => Promise<R>): Promise<R> {
  const lessonId = lesson.id;
  try {
    return await fn();
  } catch (raw) {
    const err = asJobError(raw);
    const c = classifyError(err);
    const permanent = err instanceof PermanentJobError || err instanceof ParseError || err instanceof RefusalError || (!c.retryable && c.code !== 'unknown');
    const last = ctx.job.retryCount >= def.retry.retryLimit;
    if (!permanent && !last) throw err;
    ctx.log.error('ders hattı düştü', { lesson: lessonId, stage, error: (err as Error).message, code: c.code });
    await failLesson(ctx.db, lessonId, failureText(stage, err)).catch((e: unknown) =>
      ctx.log.error('ders failed yazılamadı', { lesson: lessonId, error: (e as Error).message }),
    );
    // düşen dersin çıkarılmış sesi ve kareleri beklemez (yeniden deneme prepare ile yeniden üretir)
    const fresh = await loadLesson(ctx.db, lessonId).catch(() => null);
    await removeDerived(ctx, fresh ?? lesson, { audio: true, frames: true });
    lessonService().cleanup(lessonId).catch(() => undefined);
    if (err instanceof PermanentJobError) throw err;
    throw new PermanentJobError(failureText(stage, err), 'OGR-JOB-180');
  }
}

function safeExt(path: string): string {
  const e = extname(path).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(e) ? e : '.bin';
}

/** Türetilmiş medya yolu: yüklemenin sahibi klasörü altında ders klasörü (`<sahip>/<ders>/…`). */
export function derivedPrefix(uploadPath: string, lessonId: string): string {
  const owner = uploadPath.split('/')[0] || 'ders';
  return `${owner}/${lessonId}`;
}

// --- lesson.prepare -----------------------------------------------------------------------------------------------------

/** Ad temizliği (kapalı başarısızlık: öğrencinin adı okunamazsa düz metin hiç yazılmaz, OGR-JOB-181). */
function scrubSegments(segments: TranscriptSegment[], names: NameHashes): { segments: TranscriptSegment[]; replaced: number } {
  let replaced = 0;
  const out = segments.map((s) => {
    const r = scrubText(s.text, names);
    replaced += r.replaced;
    return { ...s, text: r.text.slice(0, 4000) || '…' };
  });
  return { segments: out, replaced };
}

async function importTranscript(ctx: JobContext, lesson: LessonRow, counters: Counters): Promise<number> {
  const up = lesson.transcript_upload!;
  if (lesson.transcript_deleted_at) {
    // dosya içe aktarılıp silinmişti (yeniden deneme): yazılmış transkriptle sürer
    const tr = await readTranscript(ctx.db, lesson.id);
    if (!tr || tr.segments.length === 0) throw new PermanentJobError('transkript dosyası artık yok: dosya yeniden yüklenmeli', 'OGR-JOB-182');
    return tr.segments.length;
  }
  const storage = requireStorage(ctx);
  const body = await storage.download(LESSON_BUCKET, up.storage_path);
  const parsed = parseTranscriptFile(body, { mime: up.mime, path: up.storage_path });
  if (parsed.length === 0) throw new PermanentJobError('transkript dosyasında okunabilir bölüm yok', 'OGR-JOB-182');
  const clean = scrubSegments(parsed, await lessonNameHashes(ctx.db, lesson.id));
  const w = await writeTranscript(ctx.db, lesson.id, clean.segments, 'tr', 'upload');
  counters.pii_replaced = clean.replaced;
  // dosya içe aktarıldı: düz adlı kopya Storage'da kalmaz (olmazsa gece işi siler)
  if (storage.remove) {
    try {
      await storage.remove(LESSON_BUCKET, [up.storage_path]);
      await markMediaDeleted(ctx.db, lesson.id, 'transcript_file');
    } catch (err) {
      ctx.log.warn('transkript dosyası silinemedi; gece işine kaldı', { lesson: lesson.id, error: (err as Error).message });
    }
  }
  return w.segments;
}

/** Servis /prepare: Storage kipinde yollar, değilse kaynak servisin çalışma köküne yazılır ve çıktılar yüklenir. */
async function prepareMedia(ctx: JobContext, svc: LessonService, health: ServiceHealth, lesson: LessonRow) {
  const up = lesson.upload!;
  const prefix = derivedPrefix(up.storage_path, lesson.id);
  if (health.storage) {
    const res = await svc.prepare({ lesson_id: lesson.id, storage_path: up.storage_path, bucket: LESSON_BUCKET, dest_prefix: prefix, max_frames: MAX_FRAMES }, ctx.signal);
    return { res, audioPath: res.audio.storage_path ?? null, frames: res.frames.filter((f) => f.storage_path).map((f) => ({ path: f.storage_path!, t: f.t, t_sec: f.t_sec })) };
  }
  // servis aynı makinede (Storage erişimi yok): kaynak çalışma köküne, çıktılar worker'dan Storage'a
  const storage = requireStorage(ctx);
  const rel = `${lesson.id}/source${safeExt(up.storage_path)}`;
  const abs = join(health.work_dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, await storage.download(LESSON_BUCKET, up.storage_path));
  const res = await svc.prepare({ lesson_id: lesson.id, local_path: rel, max_frames: MAX_FRAMES }, ctx.signal);
  const audioPath = `${prefix}/audio.wav`;
  await storage.upload(LESSON_BUCKET, audioPath, readFileSync(join(health.work_dir, res.audio.path)), 'audio/wav');
  const out: FrameRef[] = [];
  for (const f of res.frames) {
    const path = `${prefix}/frames/${f.path.split('/').pop()}`;
    await storage.upload(LESSON_BUCKET, path, readFileSync(join(health.work_dir, f.path)), 'image/jpeg');
    out.push({ path, t: f.t, t_sec: f.t_sec });
  }
  return { res, audioPath, frames: out };
}

export async function runPrepare(p: z.infer<typeof preparePayload>, ctx: JobContext): Promise<StageResult> {
  const lesson = await requireLesson(ctx, p.lesson_id);
  if (lesson.progress.stage === 'done' && ['analyzed', 'approved', 'corrected'].includes(lesson.status)) {
    return { lesson_id: lesson.id, stage: 'skipped', reason: 'already_done' };
  }
  return guarded(ctx, lessonPrepareJob, lesson, 'prepare', async () => {
    await setProgress(ctx.db, lesson.id, 'prepare', {});
    const kind = lesson.upload?.kind ?? p.upload_kind ?? null;
    const counters: Counters = {};
    let framesOut: FrameRef[] = [];
    let audioPath: string | null = null;
    if (kind === 'video' || kind === 'audio') {
      const svc = lessonService();
      const health = await svc.health();
      const prep = await prepareMedia(ctx, svc, health, lesson);
      framesOut = prep.frames;
      audioPath = prep.audioPath;
      Object.assign(counters, { duration_sec: Math.round(prep.res.duration_sec), frames_count: framesOut.length, frame_method: prep.res.method, has_video: prep.res.has_video });
      if (audioPath) counters.audio_path = audioPath;
      if (lesson.upload) counters.media_prefix = derivedPrefix(lesson.upload.storage_path, lesson.id);
    } else if (kind !== 'transcript') {
      throw new PermanentJobError(`ders yüklemesi video, ses ya da transkript olmalı (${kind ?? 'yok'})`, 'OGR-JOB-180');
    }
    if (lesson.transcript_upload) {
      counters.transcript_segments = await importTranscript(ctx, lesson, counters);
      counters.transcript_source = 'upload';
      await setProgress(ctx.db, lesson.id, 'prepare', counters);
      const next = await chain(ctx, 'lesson.label', { lesson_id: lesson.id, frames: framesOut }, lesson.id);
      return { lesson_id: lesson.id, stage: 'prepare', next: 'lesson.label', counters: { ...counters, job: next } };
    }
    if (!audioPath) throw new PermanentJobError('kayıttan ses çıkarılamadı', 'OGR-JOB-182');
    await setProgress(ctx.db, lesson.id, 'prepare', counters);
    await chain(ctx, 'lesson.stt', { lesson_id: lesson.id, audio_path: audioPath, frames: framesOut }, lesson.id);
    return { lesson_id: lesson.id, stage: 'prepare', next: 'lesson.stt', counters };
  });
}

export const lessonPrepareJob: JobDefinition<z.infer<typeof preparePayload>, StageResult> = {
  name: 'lesson.prepare',
  description: 'Ders kaydı: ffmpeg ses (16 kHz mono) + ≤ 30 sahne karesi (pipelines/ders servisi) → Storage; hazır transkript varsa içe aktarır.',
  process: 'worker',
  payload: preparePayload,
  concurrency: 2,
  retry: MEDIA_RETRY,
  handler: runPrepare,
};

// --- lesson.stt ---------------------------------------------------------------------------------------------------------

export async function runStt(p: z.infer<typeof sttPayload>, ctx: JobContext): Promise<StageResult> {
  const lesson = await requireLesson(ctx, p.lesson_id);
  return guarded(ctx, lessonSttJob, lesson, 'stt', async () => {
    await setProgress(ctx.db, lesson.id, 'stt', {});
    const audioPath = p.audio_path ?? lesson.audio_path;
    const svc = lessonService();
    const health = await svc.health();
    const req: Parameters<LessonService['stt']>[0] = { lesson_id: lesson.id, language: 'tr' };
    if (health.stt !== 'fake') {
      if (!audioPath) throw new PermanentJobError('çıkarılmış ses yok (önce lesson.prepare)', 'OGR-JOB-182');
      if (health.storage) {
        Object.assign(req, { storage_path: audioPath, bucket: LESSON_BUCKET });
      } else {
        const rel = `${lesson.id}/audio.wav`;
        const abs = join(health.work_dir, rel);
        if (!existsSync(abs)) {
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, await requireStorage(ctx).download(LESSON_BUCKET, audioPath));
        }
        req.wav_path = rel;
      }
    }
    // adlar STT'den önce okunur: öğrencinin adı yoksa ücretli STT de yapılmaz, düz metin hiç yazılmaz (OGR-JOB-181)
    const names = await lessonNameHashes(ctx.db, lesson.id);
    const res = await svc.stt(req, ctx.signal);
    const raw: TranscriptSegment[] = res.segments
      .filter((s) => s.text.trim())
      .map((s) => ({ t0: Math.max(0, s.t0), t1: Math.max(s.t0, s.t1), speaker: null, text: s.text.trim().slice(0, 4000) }));
    if (raw.length === 0) throw new PermanentJobError('kayıtta konuşma bulunamadı', 'OGR-JOB-182');
    const clean = scrubSegments(raw.slice(0, 20_000), names);
    const w = await writeTranscript(ctx.db, lesson.id, clean.segments, res.language || 'tr', res.provider);
    const counters: Counters = { segments: w.segments, stt_provider: res.provider, stt_chunks: res.chunks, pii_replaced: clean.replaced };
    // çıkarılan ses STT'den sonra gerekmez (PLAN-v2 §9): hemen silinir; olmazsa gece saklama işi siler
    const storage = storageOrNull(ctx);
    if (audioPath && storage?.remove) {
      try {
        await storage.remove(LESSON_BUCKET, [audioPath]);
        await markMediaDeleted(ctx.db, lesson.id, 'audio');
        counters.audio_deleted = true;
      } catch (err) {
        ctx.log.warn('ders sesi silinemedi; gece işine kaldı', { lesson: lesson.id, error: (err as Error).message });
      }
    }
    await setProgress(ctx.db, lesson.id, 'stt', counters);
    await chain(ctx, 'lesson.label', { lesson_id: lesson.id, frames: p.frames }, lesson.id);
    return { lesson_id: lesson.id, stage: 'stt', next: 'lesson.label', counters };
  });
}

export const lessonSttJob: JobDefinition<z.infer<typeof sttPayload>, StageResult> = {
  name: 'lesson.stt',
  description: 'Ders sesi → transkript (Groq Whisper large-v3-turbo, 25 MB parçalama; anahtarsız OGRENMEN_STT=fake) → write_lesson_transcript; ses silinir.',
  process: 'worker',
  payload: sttPayload,
  concurrency: 2,
  retry: MEDIA_RETRY,
  handler: runStt,
};

// --- lesson.label -------------------------------------------------------------------------------------------------------

function lessonKind(l: LessonRow): LessonKind {
  return l.enrollment_id ? 'one_on_one' : 'class';
}

export async function runLabel(p: z.infer<typeof stagePayload>, ctx: JobContext): Promise<StageResult> {
  const lesson = await requireLesson(ctx, p.lesson_id);
  return guarded(ctx, lessonLabelJob, lesson, 'label', async () => {
    await setProgress(ctx.db, lesson.id, 'label', {});
    const tr = await readTranscript(ctx.db, lesson.id);
    if (!tr || tr.segments.length === 0) throw new PermanentJobError('transkript yok', 'OGR-JOB-182');
    // STT ve içe aktarma temiz yazar; yine de yeniden temizlenir (eğitmen düzeltmesi, eski satırlar)
    const names = await lessonNameHashes(ctx.db, lesson.id);
    const { segments: segs, replaced } = scrubSegments(tr.segments, names);
    const counters: Counters = { pii_replaced_label: replaced, label_windows: 0 };
    const todo = segs.map((s, i) => ({ ...s, i })).filter((s) => !s.speaker);
    if (todo.length > 0) {
      const gateway = await ctx.gateway();
      const prompt = await systemPrompt(ctx.db, 'speaker_label');
      const students = await lessonStudents(ctx.db, lesson);
      const studentRef = lessonKind(lesson) === 'one_on_one' ? (students[0]?.public_ref ?? null) : null;
      const windows = labelWindows(todo);
      let cost = 0;
      let matched = 0;
      for (const [wi, w] of windows.entries()) {
        const user = speakerLabelUserText({ kind: lessonKind(lesson), window: wi + 1, windows: windows.length, segments: w });
        assertNoNames(user, names, 'etiketleme istemi');
        const res = await gateway.call('speaker_label', {
          system: { product: prompt.text }, user, turn: { now: ctx.now() }, promptVersion: prompt.version, studentRef,
          ref: { table: 'lessons', id: lesson.id }, signal: ctx.signal,
        });
        cost += res.costUsd;
        const out = (res.data as Transcript).segments;
        const al = alignLabels(w, out, hms);
        matched += al.matched;
        al.speakers.forEach((sp, k) => {
          if (sp) segs[w[k]!.i]!.speaker = sp;
        });
      }
      Object.assign(counters, { label_windows: windows.length, labeled_segments: matched, label_cost_usd: Math.round(cost * 1e6) / 1e6 });
    }
    counters.unlabeled = segs.filter((s) => !s.speaker).length;
    await writeTranscript(ctx.db, lesson.id, segs, tr.language, tr.provider);
    await setProgress(ctx.db, lesson.id, 'label', counters);
    await chain(ctx, 'lesson.analyse', { lesson_id: lesson.id, frames: p.frames }, lesson.id);
    return { lesson_id: lesson.id, stage: 'label', next: 'lesson.analyse', counters };
  });
}

export const lessonLabelJob: JobDefinition<z.infer<typeof stagePayload>, StageResult> = {
  name: 'lesson.label',
  description: 'Ders transkripti: ad temizliği (packages/pii) + konuşmacı etiketleme (speaker_label, Sonnet low, 10 dk pencereler).',
  process: 'worker',
  payload: stagePayload,
  concurrency: 2,
  retry: LLM_RETRY,
  handler: runLabel,
};

// --- lesson.analyse -----------------------------------------------------------------------------------------------------

async function paidAllowed(ctx: JobContext, gateway: Gateway, studentRef: string | null): Promise<boolean> {
  if (gateway.transport.kind === 'fake') return true;
  const r = await ctx.db.query('select paid_allowed from public.check_spend($1, $2)', ['lesson_analysis', studentRef]).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  return r.rows[0]?.paid_allowed !== false;
}

/** Analize giden görsel kareler: kare başına ≤ FRAME_MAX_BYTES, toplam base64 ≤ FRAMES_BASE64_BUDGET (dolunca kalan atlanır). */
export async function frameBlocks(ctx: JobContext, refs: readonly FrameRef[]) {
  const storage = storageOrNull(ctx);
  const blocks: { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } }[] = [];
  const used: { n: number; t: string }[] = [];
  if (!storage) return { blocks, used };
  let budget = FRAMES_BASE64_BUDGET;
  for (const f of refs.slice(0, MAX_FRAMES)) {
    try {
      const buf = await storage.download(LESSON_BUCKET, f.path);
      if (buf.length === 0 || buf.length > FRAME_MAX_BYTES) continue;
      const data = buf.toString('base64');
      // toplam bütçe dolunca kalan kareler atlanır (istek 32 MB sınırının altında kalır; analiz karesiz de sürer)
      if (data.length > budget) break;
      budget -= data.length;
      blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
      used.push({ n: used.length + 1, t: f.t });
    } catch (err) {
      ctx.log.warn('ders karesi okunamadı', { path: f.path, error: (err as Error).message });
    }
  }
  return { blocks, used };
}

async function analysisSystem(ctx: JobContext, product: string, lesson: LessonRow, studentId: string | null): Promise<{ system: SystemParts; dossierHash: string | null }> {
  if (studentId && lesson.course_id) {
    try {
      const b = await buildPromptSystem(ctx.db, { product, studentId, courseId: lesson.course_id, dossier: { maxAgeMs: 10 * 60_000 } });
      return { system: b.system, dossierHash: b.dossier.hash };
    } catch (err) {
      ctx.log.warn('dossier kurulamadı; analiz ders bloğuyla sürer', { lesson: lesson.id, error: (err as Error).message });
    }
  }
  if (lesson.course_id) {
    const c = await renderCourseBlock(ctx.db, lesson.course_id, { curriculumId: lesson.curriculum_id }).catch(() => null);
    if (c) return { system: { product, course: c.text }, dossierHash: null };
  }
  return { system: { product }, dossierHash: null };
}

/**
 * Son analiz transkriptten yeni mi (aynı girdiyle yazılmış): iş, yazımdan sonra düşüp yeniden denendiyse model yeniden
 * çağrılmaz (maliyet; yeni sürüm aynı kanıtı yeniden uygulamaz), uygulamadan sürülür.
 */
async function freshAnalysis(ctx: JobContext, lessonId: string): Promise<{ id: string; claims: number } | null> {
  const r = await ctx.db.query(
    `select la.id, (select count(*)::int from public.lesson_claims lc where lc.analysis_id = la.id) as claims
       from public.lesson_analyses la
       left join public.lesson_transcripts lt on lt.lesson_id = la.lesson_id
      where la.lesson_id = $1::uuid
        and la.version = (select max(x.version) from public.lesson_analyses x where x.lesson_id = $1::uuid)
        and la.created_at > coalesce(lt.updated_at, '-infinity'::timestamptz)`,
    [lessonId],
  );
  const x = r.rows[0];
  return x ? { id: String(x.id), claims: Number(x.claims ?? 0) } : null;
}

export async function runAnalyse(p: z.infer<typeof stagePayload>, ctx: JobContext): Promise<StageResult> {
  const lesson = await requireLesson(ctx, p.lesson_id);
  return guarded(ctx, lessonAnalyseJob, lesson, 'analyse', async () => {
    const students = await lessonStudents(ctx.db, lesson);
    const done = await freshAnalysis(ctx, lesson.id);
    let analysisId: string;
    let counters: Counters;
    if (done) {
      analysisId = done.id;
      counters = { claims: done.claims, resumed: true };
      ctx.log.info('ders analizi zaten yazılmış; uygulamadan sürülüyor', { lesson: lesson.id, analysis: done.id });
    } else {
      const w = await analyse(p, ctx, lesson, students);
      analysisId = w.analysisId;
      counters = w.counters;
    }
    await setProgress(ctx.db, lesson.id, 'apply', counters);
    const applied = (await ctx.db.query('select public.apply_lesson_claims($1::uuid) as r', [lesson.id])).rows[0]!.r as { applied: number; pending: number; total: number };
    Object.assign(counters, { applied: Number(applied.applied ?? 0), pending: Number(applied.pending ?? 0) });
    counters.notified = await notifyInstructors(ctx.db, lesson, analysisId, Number(applied.pending ?? 0)).catch((e: unknown) => {
      ctx.log.warn('eğitmen bildirimi yazılamadı', { lesson: lesson.id, error: (e as Error).message });
      return 0;
    });
    for (const s of students) {
      await ctx.enqueue('suggestions.refresh', { student_id: s.student_id, reason: 'lesson.analyse' }, debounced(`suggestions:${s.student_id}`)).catch(() => null);
    }
    await setProgress(ctx.db, lesson.id, 'done', counters);
    // kareler yalnız analiz içindir (öğrencinin yüzü, tahtadaki ad): analiz bitince silinir
    if ((lesson.frames_count ?? 0) > 0 || p.frames.length > 0) await removeDerived(ctx, lesson, { frames: true });
    lessonService().cleanup(lesson.id).catch(() => undefined);
    ctx.log.info('ders analizi bitti', { lesson: lesson.id, claims: counters.claims, applied: counters.applied, pending: counters.pending });
    return { lesson_id: lesson.id, stage: 'done', next: null, counters: { ...counters, analysis_id: analysisId } };
  });
}

/** Model turu (+ gerekirse bir onarım turu) → bağlam denetimi → write_lesson_analysis. */
async function analyse(p: z.infer<typeof stagePayload>, ctx: JobContext, lesson: LessonRow, students: Awaited<ReturnType<typeof lessonStudents>>): Promise<{ analysisId: string; counters: Counters }> {
  await setProgress(ctx.db, lesson.id, 'analyse', {});
  if (!lesson.curriculum_id) throw new PermanentJobError('dersin müfredatı yok', 'OGR-JOB-180');
  const tr = await readTranscript(ctx.db, lesson.id);
  if (!tr || tr.segments.length === 0) throw new PermanentJobError('transkript yok', 'OGR-JOB-182');
  const kind = lessonKind(lesson);
  const one = kind === 'one_on_one' ? (students[0] ?? null) : null;
  const studentRef = one?.public_ref ?? null;
  const names = await lessonNameHashes(ctx.db, lesson.id);
  const gateway = await ctx.gateway();
  if (!(await paidAllowed(ctx, gateway, studentRef))) throw new PermanentJobError('ücretli model kullanımı şu an kapalı (harcama kapısı)', 'OGR-JOB-183');

  const [prompt, openRaw, prev, leaves, images] = await Promise.all([
    systemPrompt(ctx.db, 'lesson_analysis'),
    openMisconceptions(ctx.db, lesson.enrollment_id),
    previousNextStep(ctx.db, lesson),
    leafSkills(ctx.db, lesson.curriculum_id),
    frameBlocks(ctx, p.frames),
  ]);
  const { system, dossierHash } = await analysisSystem(ctx, prompt.text, lesson, one?.student_id ?? null);
  // modele giden her eğitmen/kullanıcı metni temizlenir: transkript (yüklenen/düzeltilen metin), ders başlığı ("Ayşe ile
  // türev"), açık yanılgıların eğitmen metni, önceki sonraki adım
  const clean = (t: string): string => scrubText(t, names).text;
  const segments = tr.segments.map((s) => ({ ...s, text: clean(s.text) }));
  const open = openRaw.map((m) => ({ ...m, text: clean(m.text) }));
  const title = lesson.title ? clean(lesson.title) : null;
  const endSec = Math.max(lesson.duration_sec ?? 0, ...segments.map((s) => s.t1));
  const durationMin = lesson.duration_min ?? (endSec > 0 ? Math.max(1, Math.ceil(endSec / 60)) : null);
  const lessonRef = lesson.id;
  const ref = studentRef ?? students[0]?.public_ref ?? CLASS_STUDENT_REF;
  const text = lessonAnalysisUserText({
    lessonRef, studentRef: ref, kind, title, date: lesson.held_at.slice(0, 10), durationMin,
    frames: images.used, openMisconceptions: open, previousNextStep: prev ? clean(prev) : null, segments,
  });
  assertNoNames(text, names, 'analiz istemi');
  const firstUser = [...images.blocks, { type: 'text' as const, text }];
  const base = { system, turn: { now: ctx.now() }, promptVersion: prompt.version, studentRef, ref: { table: 'lessons', id: lesson.id }, signal: ctx.signal };
  const checkCtx = {
    lessonRef, studentRef: ref, durationMin, maxSec: endSec, texts: segments.map((s) => s.text), leaves,
    openMisconceptionIds: new Set(open.map((m) => m.id)), names,
  };
  let res = await gateway.call('lesson_analysis', { ...base, user: firstUser });
  let cost = res.costUsd;
  let checked = checkLessonAnalysis(res.data as LessonAnalysis, checkCtx);
  let repaired = false;
  let settled = { dropped: 0, held: 0 };
  if (checked.report.studentTextIssues.length > 0) {
    // onarım turu: önceki yanıt asistan turu olarak gider; model yalnız sorunlu alanları düzeltir
    res = await gateway.call('lesson_analysis', {
      ...base,
      history: [
        { role: 'user', content: firstUser },
        { role: 'assistant', content: JSON.stringify(res.data) },
      ],
      user: repairNote(checked.report.studentTextIssues),
    });
    cost += res.costUsd;
    checked = checkLessonAnalysis(res.data as LessonAnalysis, checkCtx);
    repaired = true;
    if (checked.report.studentTextIssues.length > 0) {
      // ders düşmez: sorunlu söz çıkar, diğerleri eğitmen incelemesinde (boş güven)
      ctx.log.warn('öğrenci metinleri onarımdan sonra da kurala uymuyor; eğitmen incelemesine kaldı', { lesson: lesson.id, issues: checked.report.studentTextIssues.slice(0, 5) });
      const s = settleStudentTexts(checked.analysis, checked.report.studentTextIssues);
      checked = { ...checked, analysis: s.analysis };
      settled = { dropped: s.dropped, held: s.held };
    }
  }
  const analysis = {
    ...checked.analysis,
    model_notes: {
      model: res.model, prompt_version: prompt.version, cost_usd: Math.round(cost * 1e6) / 1e6,
      tokens_in: res.usage.input + res.usage.cacheRead + res.usage.cacheWrite5m + res.usage.cacheWrite1h, tokens_out: res.usage.output, frames: images.used.length,
    },
  };
  assertNoNames(JSON.stringify(analysis), names, 'analiz çıktısı');
  const w = (await ctx.db.query('select public.write_lesson_analysis($1::uuid, $2::jsonb) as r', [
    lesson.id,
    JSON.stringify({
      analysis, model: res.model, cost_usd: analysis.model_notes.cost_usd,
      seed_profile: { kind, open_misconceptions: open.map((m) => ({ id: m.id, tag: m.tag, skill_id: m.skill_id })), previous_next_step: prev ? true : false, dossier_hash: dossierHash, frames: images.used.length },
    }),
  ])).rows[0]!.r as { analysis_id: string; claims: number; dropped: number; reverted?: number };
  const counters: Counters = {
    claims: w.claims, claims_dropped: w.dropped, quotes_dropped: checked.report.quotesDropped, items_dropped: checked.report.itemsDropped,
    names_scrubbed: checked.report.namesScrubbed, frames_used: images.used.length, repaired, analysis_cost_usd: analysis.model_notes.cost_usd,
  };
  if (w.reverted) counters.claims_reverted = w.reverted;
  if (settled.dropped || settled.held) Object.assign(counters, { student_text_dropped: settled.dropped, student_text_held: settled.held });
  return { analysisId: w.analysis_id, counters };
}

export const lessonAnalyseJob: JobDefinition<z.infer<typeof stagePayload>, StageResult> = {
  name: 'lesson.analyse',
  description: 'Ders analizi (lesson_analysis, Opus high; kareler + transkript + dossier) → write_lesson_analysis → apply_lesson_claims → bildirim + Bugün.',
  process: 'worker',
  payload: stagePayload,
  concurrency: 2,
  retry: LLM_RETRY,
  handler: runAnalyse,
};

// --- lesson.retention ---------------------------------------------------------------------------------------------------

export interface RetentionResult {
  /** Takılıp failed yapılan ders sayısı. */
  stale: number;
  due: number;
  deleted: Record<LessonMedia, number>;
  failed: number;
  next: string | null;
}

/**
 * Takılan dersler: processing ve ilerlemesi STALE_HOURS saattir yazılmamış (her aşama denemesi başında yazar), kuyrukta
 * o derse ait bekleyen/çalışan lesson.* işi yok (pg-boss şeması okunamazsa yalnız süre). İşçi son denemede ölünce
 * (dağıtım, OOM) handler'ın catch'i çalışmaz; ders failed olur ve eğitmen "Yeniden dene" görür.
 */
async function failStale(ctx: JobContext): Promise<number> {
  const base = `select l.id from public.lessons l
                 where l.status = 'processing'
                   and coalesce((l.progress ->> 'updated_at')::timestamptz, l.created_at) < now() - make_interval(hours => $1::int)`;
  const schema = ctx.config.bossSchema;
  let rows: Record<string, unknown>[];
  try {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('pg-boss şeması geçersiz');
    rows = (await ctx.db.query(
      `${base} and not exists (select 1 from ${schema}.job j
                                where j.name like 'lesson.%' and j.state in ('created', 'retry', 'active')
                                  and j.data ->> 'lesson_id' = l.id::text)
        order by l.created_at limit 100`,
      [STALE_HOURS],
    )).rows;
  } catch {
    rows = (await ctx.db.query(`${base} order by l.created_at limit 100`, [STALE_HOURS])).rows;
  }
  let n = 0;
  for (const x of rows) {
    const id = String(x.id);
    try {
      await failLesson(ctx.db, id, 'İşlem yarıda kaldı: yeniden deneyebilirsiniz', { stale: true });
      n++;
    } catch (err) {
      ctx.log.warn('takılan ders failed yazılamadı', { lesson: id, error: (err as Error).message });
    }
  }
  return n;
}

type RetentionItem = { lesson_id: string; media: LessonMedia; bucket: string; storage_path: string | null; paths?: string[] | null };

export async function runRetention(p: z.infer<typeof retentionPayload>, ctx: JobContext): Promise<RetentionResult> {
  const out: RetentionResult = { stale: 0, due: 0, deleted: { video: 0, audio: 0, frames: 0, transcript_file: 0 }, failed: 0, next: null };
  // takılan dersler önce: düşünce sesleri ve kareleri bu turun silme listesine girer
  out.stale = await failStale(ctx).catch((err: unknown) => {
    ctx.log.warn('takılan dersler okunamadı', { error: (err as Error).message });
    return 0;
  });
  const r = await ctx.db.query('select public.lesson_retention_due($1::int) as r', [p.limit]);
  const due = (r.rows[0]?.r ?? []) as RetentionItem[];
  out.due = due.length;
  const storage = due.length > 0 ? storageOrNull(ctx) : null;
  if (due.length > 0 && !storage?.remove) throw new PermanentJobError('Storage silme yapılandırılmadı: ders medyası silinemez', 'OGR-JOB-180');
  for (const item of due) {
    try {
      const paths = (item.paths ?? []).filter((x): x is string => typeof x === 'string' && x.length > 0);
      if (paths.length === 0 && item.storage_path && item.media !== 'frames') paths.push(item.storage_path);
      if (paths.length > 0) await storage!.remove!(item.bucket || LESSON_BUCKET, paths);
      await markMediaDeleted(ctx.db, item.lesson_id, item.media);
      out.deleted[item.media]++;
    } catch (err) {
      out.failed++;
      ctx.log.warn('ders medyası silinemedi', { lesson: item.lesson_id, media: item.media, error: (err as Error).message });
    }
  }
  if (due.length >= p.limit) {
    out.next = await ctx.enqueue('lesson.retention', { limit: p.limit, reason: 'more' }, { startAfter: 60, singletonKey: 'lesson.retention:more', singletonSeconds: 60 }).catch(() => null);
  }
  ctx.log.info('ders saklama işi', { stale: out.stale, due: out.due, ...out.deleted, failed: out.failed });
  return out;
}

export const lessonRetentionJob: JobDefinition<z.infer<typeof retentionPayload>, RetentionResult> = {
  name: 'lesson.retention',
  description: 'Gece 04:15 (zamanlama): takılan dersler failed; süresi dolan ham ders videoları (90 gün), kalan çıkarılmış sesler ve kareler, içe aktarılmış transkript dosyaları Storage\'dan silinir.',
  process: 'worker',
  payload: retentionPayload,
  concurrency: 1,
  retry: { retryLimit: 2, retryDelay: 300, retryBackoff: true, retryDelayMax: 3600, expireInSeconds: 1800, deleteAfterSeconds: 7 * 86_400 },
  handler: runRetention,
};

// --- memory.apply -------------------------------------------------------------------------------------------------------

export const memoryApplyJob: JobDefinition<z.infer<typeof memoryPayload>, MemoryApplyResult> = {
  name: 'memory.apply',
  description: 'Hafıza dosyası güncellemesi (apply_lesson_claims: dersin onaylı bilgileri → /memories/courses/<kod>.md).',
  process: 'worker',
  payload: memoryPayload,
  concurrency: 2,
  retry: { retryLimit: 3, retryDelay: 30, retryBackoff: true, retryDelayMax: 600, expireInSeconds: 300, deleteAfterSeconds: 7 * 86_400 },
  handler: (p, ctx) => applyLessonMemory(ctx.db, p),
};

/** Kayıt defterine tek satırla girer (registry.ts). */
export const LESSON_JOBS: readonly AnyJobDefinition[] = [lessonPrepareJob, lessonSttJob, lessonLabelJob, lessonAnalyseJob, lessonRetentionJob, memoryApplyJob];
