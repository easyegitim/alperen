// Dersler (P5-C, mockup S14): eğitmen ders listesi / iddia incelemesi ve öğrenci "Dersler" satırının saf kuralları.
// İstemci ve sunucu kullanır; 'server-only' değildir. RPC yanıt biçimleri supabase/migrations/0040–0041'den
// (list_lessons, lesson_view, register_lesson, review_lesson_claim, apply_lesson_claims, lesson_set_options).
import { z } from 'zod';

// --- Yükleme kuralları ------------------------------------------------------------------------------------------------

export const LESSON_BUCKET = 'lessons';

/** 'lessons' kovasının dosya sınırı (0015_storage.sql: 5 GB). */
export const LESSON_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/** TUS parça boyutu: Supabase resumable yükleme 6 MB'ı zorunlu kılar. */
export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;

export type LessonFileKind = 'video' | 'audio' | 'transcript';

interface MimeRule {
  mime: string;
  kind: LessonFileKind;
}

/** Uzantı → kovanın izin verdiği MIME ve `uploads.kind`. Tarayıcı .srt/.vtt/.m4a için tür bildirmeyebilir. */
const BY_EXTENSION: Record<string, MimeRule> = {
  mp4: { mime: 'video/mp4', kind: 'video' },
  m4v: { mime: 'video/mp4', kind: 'video' },
  mov: { mime: 'video/quicktime', kind: 'video' },
  webm: { mime: 'video/webm', kind: 'video' },
  mp3: { mime: 'audio/mpeg', kind: 'audio' },
  m4a: { mime: 'audio/mp4', kind: 'audio' },
  wav: { mime: 'audio/wav', kind: 'audio' },
  txt: { mime: 'text/plain', kind: 'transcript' },
  vtt: { mime: 'text/vtt', kind: 'transcript' },
  srt: { mime: 'application/x-subrip', kind: 'transcript' },
  jsonl: { mime: 'application/x-ndjson', kind: 'transcript' },
  json: { mime: 'application/json', kind: 'transcript' },
};

export const LESSON_ACCEPT = Object.keys(BY_EXTENSION)
  .map((e) => `.${e}`)
  .join(',');

export interface LessonFileInfo {
  ext: string;
  mime: string;
  kind: LessonFileKind;
}

/** Dosya adından kabul edilen tür; desteklenmeyen uzantı null. Ses kaydı olarak gelen webm/mp4 gövdesi video sayılır. */
export function lessonFileInfo(name: string): LessonFileInfo | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  if (!m) return null;
  const ext = m[1]!.toLowerCase();
  const rule = BY_EXTENSION[ext];
  return rule ? { ext, ...rule } : null;
}

export type FileCheck = { ok: true; info: LessonFileInfo } | { ok: false; message: string };

export function checkLessonFile(file: { name: string; size: number }): FileCheck {
  const info = lessonFileInfo(file.name);
  if (!info) return { ok: false, message: 'Bu dosya türünü alamıyorum. Video (mp4, mov, webm), ses (mp3, m4a, wav) ya da transkript (txt, vtt, srt) seç.' };
  if (!(file.size > 0)) return { ok: false, message: 'Dosya boş görünüyor.' };
  if (file.size > LESSON_MAX_BYTES) return { ok: false, message: 'Dosya 5 GB sınırını aşıyor. Sesi ayrı çıkarıp yüklemeyi dene.' };
  return { ok: true, info };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** Storage nesne adı: '<eğitmen auth.uid()>/<yükleme>.<uzantı>' (TUS politikası ilk klasörü yükleyenle eşler). */
export function lessonObjectPath(ownerId: string, uploadId: string, ext: string): string {
  if (!isUuid(ownerId) || !isUuid(uploadId) || !/^[a-z0-9]{2,5}$/.test(ext)) throw new Error('geçersiz yükleme adı');
  return `${ownerId}/${uploadId}.${ext}`;
}

/** Biçimlendirme: tarayıcıdaki ham bayt sayısı → "1,4 GB". */
export function formatBytes(n: number): string {
  if (!(n >= 0)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const s = i === 0 || v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace('.', ',');
  return `${s} ${units[i]}`;
}

// --- Eylem girdisi (sunucu eylemi bunu doğrular) ----------------------------------------------------------------------

export const THRESHOLD = { min: 0.5, max: 1, step: 0.05, default: 0.8 } as const;

export interface RegisterInput {
  uploadId: string;
  path: string;
  mime: string;
  bytes: number;
  kind: LessonFileKind;
  enrollmentId: string;
  title: string | null;
  heldAt: string | null;
  /** Aynı derse eşlik eden transkript dosyası (isteğe bağlı). */
  transcript: { uploadId: string; path: string; mime: string; bytes: number } | null;
}

const MIMES = new Set(Object.values(BY_EXTENSION).map((r) => r.mime));

export function parseRegister(input: unknown, ownerId: string): { ok: true; value: RegisterInput } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  const o = input as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return bad('İstek okunamadı.');
  const file = (u: unknown, id: unknown): { uploadId: string; path: string; mime: string; bytes: number } | null => {
    const x = u as Record<string, unknown> | null;
    if (!x || !isUuid(id)) return null;
    if (typeof x.path !== 'string' || typeof x.mime !== 'string' || typeof x.bytes !== 'number') return null;
    if (!MIMES.has(x.mime) || !(x.bytes > 0) || x.bytes > LESSON_MAX_BYTES) return null;
    if (!x.path.startsWith(`${ownerId}/${id}.`) || x.path.length > 200) return null;
    return { uploadId: id, path: x.path, mime: x.mime, bytes: Math.floor(x.bytes) };
  };
  const main = file(o, o.uploadId);
  if (!main) return bad('Yüklenen dosya doğrulanamadı. Yeniden dene.');
  const kind = o.kind;
  if (kind !== 'video' && kind !== 'audio' && kind !== 'transcript') return bad('Dosya türü anlaşılamadı.');
  if (!isUuid(o.enrollmentId)) return bad('Öğrenci ve ders seç.');
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim().slice(0, 120) : null;
  let heldAt: string | null = null;
  if (typeof o.heldAt === 'string' && o.heldAt) {
    const t = Date.parse(o.heldAt);
    if (!Number.isFinite(t)) return bad('Ders zamanı okunamadı.');
    heldAt = new Date(t).toISOString();
  }
  let transcript: RegisterInput['transcript'] = null;
  if (o.transcript) {
    const t = o.transcript as Record<string, unknown>;
    transcript = file(t, t.uploadId);
    if (!transcript) return bad('Transkript dosyası doğrulanamadı. Yeniden dene.');
  }
  return { ok: true, value: { ...main, kind, enrollmentId: o.enrollmentId, title, heldAt, transcript } };
}

// --- Hat aşamaları (kelimeyle) ----------------------------------------------------------------------------------------

export type LessonStage = 'prepare' | 'stt' | 'label' | 'analyse' | 'apply' | 'done' | 'failed';

const STAGE_LINES: Record<LessonStage, string> = {
  prepare: 'Dosya hazırlanıyor',
  stt: 'Yazıya çevriliyor',
  label: 'Konuşmacılar ayrılıyor',
  analyse: 'Ders inceleniyor',
  apply: 'Dossier’e işleniyor',
  done: 'Hazır',
  failed: 'İşlenemedi',
};

/** Aşamanın sıra numarası (ilerleme çubuğu): prepare 1 … done 6. */
const STAGE_ORDER: LessonStage[] = ['prepare', 'stt', 'label', 'analyse', 'apply', 'done'];

export function isStage(v: unknown): v is LessonStage {
  return typeof v === 'string' && (v === 'failed' || (STAGE_ORDER as string[]).includes(v));
}

export function stageLine(stage: string | null | undefined): string {
  return isStage(stage) ? STAGE_LINES[stage] : 'Sıraya alındı';
}

/** 0–100 çubuk değeri (yalnız çubuk; ekranda sayı yazılmaz). */
export function stageProgress(stage: string | null | undefined): number {
  if (!isStage(stage) || stage === 'failed') return 0;
  return Math.round(((STAGE_ORDER.indexOf(stage) + 1) / STAGE_ORDER.length) * 100);
}

export function isWorking(status: string, stage: string | null | undefined): boolean {
  return status !== 'failed' && stage !== 'done' && status !== 'analyzed' && status !== 'approved' && status !== 'corrected' && stage !== 'failed';
}

/** retry_lesson'ın takılan ders eşiği (supabase 0040: 2 saat). */
export const STALLED_MS = 2 * 3600_000;

/** Takılan ders: processing ve ilerlemesi STALLED_MS'tir yazılmamış (işçi son denemede öldü); "Yeniden dene" açılır. */
export function isStalled(status: string, progress: Record<string, unknown> | null | undefined, now: number = Date.now()): boolean {
  const at = typeof progress?.updated_at === 'string' ? Date.parse(progress.updated_at) : NaN;
  return status === 'processing' && Number.isFinite(at) && now - at > STALLED_MS;
}

// --- Zaman ve biçim ---------------------------------------------------------------------------------------------------

/** 872 → "14:32"; bir saati aşarsa "1:04:32". */
export function formatClock(sec: number | null | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return '';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

/** 2880 → "48 dk"; 5400 → "1 sa 30 dk". */
export function formatDuration(sec: number | null | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '';
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `${m} dk`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} sa ${r} dk` : `${h} sa`;
}

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** "29 Eki 2026, 17:00" (İstanbul saati, sunucu ve tarayıcıda aynı). */
export function formatHeld(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('day')} ${MONTHS[Number(get('month')) - 1] ?? ''} ${get('year')}`;
  return withTime ? `${date}, ${get('hour')}:${get('minute')}` : date;
}

/** "Ders 12" ya da başlık; başlık yoksa numarayla. */
export function lessonName(l: { no: number | null; title: string | null }): string {
  const no = l.no != null ? `Ders ${l.no}` : 'Ders';
  return l.title ? `${no} · ${l.title}` : no;
}

// --- İddialar ---------------------------------------------------------------------------------------------------------

export const CLAIM_LABELS: Record<string, string> = {
  skill_mastery: 'Ustalık değerlendirmesi',
  misconception: 'Yanılgı',
  followup: 'Önceki dersten takip',
  question: 'Öğrenci sorusu',
  hesitation: 'Tereddüt',
  promise: 'Söz',
  homework: 'Ödev',
  deadline: 'Teslim tarihi',
  next_step: 'Sonraki adım',
  talk: 'Konuşma',
  course_insight: 'Ders bilgisi',
};

export function claimLabel(kind: string): string {
  return CLAIM_LABELS[kind] ?? 'İddia';
}

/** Güven kelimeyle (yüzde yazılmaz): modelin güveni eşiğe göre okunur. */
export function confidenceWord(c: number | null | undefined): string {
  if (typeof c !== 'number' || !Number.isFinite(c)) return 'Güven belirtilmedi';
  if (c >= 0.9) return 'Güven yüksek';
  if (c >= 0.75) return 'Güven iyi';
  if (c >= 0.6) return 'Güven orta';
  return 'Güven düşük';
}

export const STATUS_WORDS: Record<string, string> = {
  pending: 'Onay bekliyor',
  approved: 'Onaylandı',
  edited: 'Düzeltildi',
  rejected: 'Reddedildi',
};

/** Düzenle: ustalık değeri bantla seçilir (kelime), RPC'ye bandın orta değeri gider. */
export const MASTERY_EDIT_BANDS = [
  { word: 'Zayıf', value: 0.3 },
  { word: 'Orta', value: 0.65 },
  { word: 'İyi', value: 0.9 },
] as const;

export const FOLLOWUP_EDIT = [
  { word: 'Düzeldi', value: 'improved' },
  { word: 'Sürüyor', value: 'still_present' },
] as const;

export function canEditClaim(kind: string): boolean {
  return kind === 'skill_mastery' || kind === 'followup';
}

/** Kartın ana cümlesi: iddianın içeriği. */
export function claimText(c: { kind: string; value: Record<string, unknown> | null; edited_value: Record<string, unknown> | null; misconception_tag: string | null; skill_name: string | null }): string {
  const v = (c.edited_value ?? c.value ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof v[k] === 'string' && v[k] ? (v[k] as string) : null);
  switch (c.kind) {
    case 'skill_mastery': {
      const est = typeof v.mastery_estimate === 'number' ? v.mastery_estimate : null;
      return est == null ? 'Bu kazanımda ustalık değerlendirmesi' : `Bu derste kazanımda ${bandWord(est).toLocaleLowerCase('tr')} görünüyor`;
    }
    case 'misconception':
      return s('text_instructor') ?? s('tag') ?? c.misconception_tag ?? 'Yanılgı belirtisi';
    case 'followup':
      return v.status === 'improved' ? 'Geçen derste görülen yanılgı bu derste düzelmiş' : 'Geçen derste görülen yanılgı bu derste de sürüyor';
    case 'question':
      return v.answered === false ? 'Öğrenci bir soru sordu, yanıtı alınamadı' : 'Öğrenci bir soru sordu';
    case 'hesitation':
      return (
        { said_dont_understand: 'Öğrenci anlamadığını söyledi', long_silence: 'Uzun bir sessizlik oldu', wrong_answer: 'Öğrenci yanlış cevap verdi', asked_repeat: 'Öğrenci tekrar istedi' } as Record<string, string>
      )[String(v.kind)] ?? 'Öğrenci tereddüt etti';
    case 'promise':
    case 'homework':
    case 'deadline':
      return s('text') ?? 'Verilen söz ya da ödev';
    case 'next_step':
      return s('for_instructor') ?? s('for_student') ?? 'Sonraki adım';
    case 'talk':
      return s('notes') ?? 'Konuşma özeti';
    case 'course_insight':
      return s('text') ?? s('topic') ?? 'Ders bilgisi';
    default:
      return 'İddia';
  }
}

export function bandWord(p: number): 'Zayıf' | 'Orta' | 'İyi' {
  return p < 0.5 ? 'Zayıf' : p < 0.8 ? 'Orta' : 'İyi';
}

// --- RPC yanıtları ----------------------------------------------------------------------------------------------------

const uuid = z.string().regex(UUID_RE);
const num = z.coerce.number();
const ref = z.object({ id: uuid, name: z.string().nullable() }).passthrough();

const listRowStaff = z
  .object({
    id: uuid,
    no: num.nullable(),
    title: z.string().nullable(),
    held_at: z.string().nullable(),
    duration_sec: num.nullable(),
    status: z.string(),
    stage: z.string().nullable(),
    error: z.string().nullable().optional(),
    student_visible: z.boolean(),
    enrollment_id: uuid.nullable(),
    course_id: uuid.nullable(),
    course_title: z.string().nullable(),
    student: ref.nullable(),
    transcript_ready: z.boolean(),
    claims: z.object({ total: num, pending: num, applied: num }).nullable(),
  })
  .passthrough();
export type LessonRow = z.output<typeof listRowStaff>;

export function parseLessonList(raw: unknown): LessonRow[] {
  return z.array(listRowStaff).parse(raw ?? []);
}

const listRowStudent = z.object({ id: uuid, no: num.nullable(), title: z.string().nullable(), held_at: z.string().nullable(), duration_sec: num.nullable(), summary_ready: z.boolean() }).passthrough();
export type StudentLessonRow = z.output<typeof listRowStudent>;

export function parseStudentLessons(raw: unknown): StudentLessonRow[] {
  return z.array(listRowStudent).parse(raw ?? []);
}

const record = z.record(z.string(), z.unknown());

const segment = z.object({ t0: num, t1: num, speaker: z.string().nullable().optional(), text: z.string() }).passthrough();
export type Segment = z.output<typeof segment>;

const claim = z
  .object({
    id: uuid,
    kind: z.string(),
    skill_id: z.string().nullable(),
    skill_name: z.string().nullable(),
    misconception_tag: z.string().nullable(),
    value: record.nullable(),
    edited_value: record.nullable(),
    confidence: num.nullable(),
    below_threshold: z.boolean(),
    quote: z.string().nullable(),
    speaker: z.string().nullable(),
    t_start_sec: num.nullable(),
    t_end_sec: num.nullable(),
    status: z.enum(['pending', 'approved', 'edited', 'rejected']),
    auto: z.boolean(),
    decided_at: z.string().nullable(),
    applied: z.boolean(),
    applied_at: z.string().nullable(),
    mastery: z.object({ p: num, evidence_count: num }).nullable(),
    effect: z.object({ p_before: num, p_after: num }).nullable(),
  })
  .passthrough();
export type LessonClaim = z.output<typeof claim>;

const lessonStaff = z
  .object({
    id: uuid,
    no: num.nullable(),
    title: z.string().nullable(),
    held_at: z.string().nullable(),
    duration_sec: num.nullable(),
    status: z.string(),
    stage: z.string().nullable(),
    progress: record,
    student_visible: z.boolean(),
    auto_apply_threshold: num,
    retain_until: z.string().nullable(),
    video_deleted_at: z.string().nullable(),
    audio_deleted_at: z.string().nullable(),
    course_title: z.string().nullable(),
    student: ref.nullable(),
    instructor: ref.nullable(),
    can_manage: z.boolean(),
  })
  .passthrough();

const staffView = z.object({
  role: z.literal('staff'),
  lesson: lessonStaff,
  transcript: z.object({ segments: z.array(segment), language: z.string().nullable(), provider: z.string().nullable(), labeled: z.boolean(), segment_count: num }).passthrough().nullable(),
  analysis: z.object({ id: uuid, version: num, status: z.string() }).passthrough().nullable(),
  claims: z.array(claim),
  counts: z.object({ total: num, pending: num, applied: num, rejected: num }),
});
export type LessonStaffView = z.output<typeof staffView>;

export function parseStaffView(raw: unknown): LessonStaffView {
  return staffView.parse(raw);
}

const studentView = z.object({
  role: z.literal('student'),
  lesson: z.object({ id: uuid, no: num.nullable(), title: z.string().nullable(), held_at: z.string().nullable(), duration_sec: num.nullable() }).passthrough(),
  summary: z.object({ ready: z.boolean(), next_step: z.string().nullable(), topics: z.array(z.string()), homework: z.array(z.object({ text: z.string().nullable(), due: z.string().nullable() })) }),
});
export type LessonStudentView = z.output<typeof studentView>;

export function parseStudentView(raw: unknown): LessonStudentView {
  return studentView.parse(raw);
}

/** Öğrenci satırının tek cümlesi: sonraki adım, yoksa konuşulan kazanımlar, yoksa hazırlanıyor. */
export function studentLessonSentence(v: LessonStudentView | null): string {
  if (!v || !v.summary.ready) return 'Özet hazırlanıyor.';
  const next = v.summary.next_step?.trim();
  if (next) return next.length > 160 ? `${next.slice(0, 157).trimEnd()}...` : next;
  if (v.summary.topics.length > 0) return `Konuştuklarımız: ${v.summary.topics.slice(0, 3).join(', ')}.`;
  const hw = v.summary.homework.find((h) => h.text);
  return hw?.text ? `Ödev: ${hw.text}` : 'Özet hazırlanıyor.';
}

// --- Hata iletileri ---------------------------------------------------------------------------------------------------

export const GENERIC_ERROR = 'İşlem yapılamadı. Biraz sonra yeniden dene.';

export const LESSON_ERRORS: Record<string, string> = {
  'OGR-AUTH-001': 'Bu dersi görme yetkin yok.',
  'OGR-AUTH-002': 'Bu işlemi yalnız dersin eğitmeni yapabilir.',
  'OGR-LESSON-001': 'Yüklenen dosya ders için uygun değil.',
  'OGR-LESSON-002': 'Bu ders için bir müfredat bulunamadı.',
  'OGR-LESSON-003': 'Bu dersin kaydı artık yok; dosyayı yeniden yüklemen gerekiyor.',
  'OGR-LESSON-004': 'Bu dersin henüz incelemesi yok.',
  'OGR-LESSON-005': 'Bu iddia artık güncel değil. Sayfayı yenile.',
  'OGR-LESSON-006': 'Bu iddia geri alınamıyor: sonrasında aynı kazanımda yeni bir gözlem var.',
};
