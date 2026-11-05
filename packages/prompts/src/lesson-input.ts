/**
 * Ders hattı (P5, docs/PLAN-v2.md §9) kullanıcı turu metinleri:
 *   - konuşmacı etiketleme: speaker_label + `speakerLabelUserText` (`<lesson_transcript_window>`: 10 dakikalık pencere,
 *     satır başına `[i] SS:DD:ss–SS:DD:ss | metin`)
 *   - ders analizi: lesson_analysis + `lessonAnalysisUserText` (`<lesson_request>` JSON + `<transcript>` satırları;
 *     kareler çağıranın eklediği görsel bloklarıdır, sırası `frames` listesindekiyle aynı)
 *
 * Metinler ad temizliğinden (packages/pii) geçmiş olarak gelir; burada yalnız veri bloğu kapatılamasın diye `<`/`>`
 * değiştirilir ve satır sonları düzlenir. Sahte taşımanın (OGRENMEN_LLM=fake) eşleme anahtarları
 * `LESSON_WINDOW_MARK` ve `LESSON_REQUEST_MARK`'tır.
 */

export const LESSON_WINDOW_MARK = '<lesson_transcript_window>';
export const LESSON_REQUEST_MARK = '<lesson_request>';
/** Konuşmacı etiketleme penceresi (sn): PLAN-v2 §9 "Sonnet 10 dk pencerelerde". */
export const LABEL_WINDOW_SEC = 600;

export type LessonKind = 'one_on_one' | 'class';
export type LessonSpeaker = 'ÖĞRENCİ' | 'EĞİTMEN';

/** Transkript metni modele giderken (ve alıntı denetiminde) bu biçime girer: tek satır, `<`/`>` değiştirilmiş. */
export function lessonText(s: string, max = 4000): string {
  return clean(s, max);
}

function clean(s: string, max = 4000): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/</g, '‹').replace(/>/g, '›').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}

function jsonBlock(v: unknown): string {
  return JSON.stringify(v, null, 1).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/** Saniye → `SS:DD:ss` (transcript / lesson-analysis zaman damgası biçimi). */
export function hms(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** `SS:DD:ss` → saniye (geçersizse null). */
export function hmsSeconds(ts: string | null | undefined): number | null {
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(ts ?? '');
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

export interface LessonSegment {
  t0: number;
  t1: number;
  speaker?: LessonSpeaker | 'DİĞER' | null;
  text: string;
}

/** Bölümleri `windowSec` saniyelik pencerelere böler (bölüm başlangıcına göre; boş pencere yok). */
export function labelWindows<T extends { t0: number }>(segments: readonly T[], windowSec = LABEL_WINDOW_SEC): T[][] {
  const out = new Map<number, T[]>();
  for (const s of segments) {
    const k = Math.floor(Math.max(0, s.t0) / windowSec);
    const w = out.get(k) ?? [];
    w.push(s);
    out.set(k, w);
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, w]) => w);
}

export interface SpeakerLabelInput {
  kind: LessonKind;
  /** 1'den başlayan pencere sırası ve toplam pencere. */
  window: number;
  windows: number;
  segments: readonly LessonSegment[];
}

export function speakerLabelUserText(i: SpeakerLabelInput): string {
  const kind = i.kind === 'class' ? 'sınıf dersi (birden çok öğrenci)' : 'birebir ders';
  const lines = i.segments.map((s, n) => `[${n + 1}] ${hms(s.t0)}–${hms(Math.max(s.t0, s.t1))} | ${clean(s.text)}`);
  return [
    LESSON_WINDOW_MARK,
    `Ders türü: ${kind}. Pencere ${i.window}/${i.windows}; ${i.segments.length} bölüm.`,
    ...lines,
    '</lesson_transcript_window>',
    `Her bölüm için aynı sırayla bir öğe yaz (toplam ${i.segments.length}).`,
  ].join('\n');
}

export interface OpenMisconception {
  id: string;
  tag: string | null;
  skill_id: string | null;
  text: string;
}

export interface LessonAnalysisInput {
  lessonRef: string;
  studentRef: string;
  kind: LessonKind;
  title: string | null;
  /** Ders tarihi (YYYY-AA-GG, İstanbul). */
  date: string | null;
  durationMin: number | null;
  /** Ekli görsellerin sırasıyla: kare no ve zamanı. */
  frames: readonly { n: number; t: string }[];
  openMisconceptions: readonly OpenMisconception[];
  previousNextStep: string | null;
  /** Etiketli, temizlenmiş bölümler. */
  segments: readonly LessonSegment[];
}

/** Transkript satırları: `SS:DD:ss–SS:DD:ss ÖĞRENCİ: metin` (alıntı denetimi bu metne karşı yapılır). */
export function transcriptLines(segments: readonly LessonSegment[]): string[] {
  return segments.map((s) => `${hms(s.t0)}–${hms(Math.max(s.t0, s.t1))} ${s.speaker ?? 'BELİRSİZ'}: ${clean(s.text)}`);
}

export function lessonAnalysisUserText(i: LessonAnalysisInput): string {
  const req = {
    lesson_ref: i.lessonRef,
    student_ref: i.studentRef,
    lesson_kind: i.kind === 'class' ? 'class' : 'one_on_one',
    title: i.title ? clean(i.title, 120) : null,
    date: i.date,
    duration_min: i.durationMin,
    frames: i.frames,
    open_misconceptions: i.openMisconceptions.map((m) => ({ id: m.id, tag: m.tag, skill_id: m.skill_id, text: clean(m.text, 300) })),
    previous_next_step_for_instructor: i.previousNextStep ? clean(i.previousNextStep, 400) : null,
  };
  return [
    LESSON_REQUEST_MARK,
    jsonBlock(req),
    '</lesson_request>',
    '<transcript>',
    ...transcriptLines(i.segments),
    '</transcript>',
    i.frames.length > 0
      ? `Mesajın başındaki ${i.frames.length} görsel, frames listesindeki sırayla dersin kareleridir.`
      : 'Bu derste kare yok (yalnız ses kaydı).',
  ].join('\n');
}
