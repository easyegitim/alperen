/**
 * Transkript yardımcıları: eğitmenin yüklediği hazır transkriptin ayrıştırılması (JSON, WebVTT, SRT, düz metin) ve
 * konuşmacı etiketleme penceresinin modele giden bölümlerle hizalanması.
 */
import type { TranscriptSegment } from './db.js';

const MAX_TEXT = 4000;
const SPEAKER_WORDS: Record<string, TranscriptSegment['speaker']> = {
  'öğrenci': 'ÖĞRENCİ',
  ogrenci: 'ÖĞRENCİ',
  student: 'ÖĞRENCİ',
  'eğitmen': 'EĞİTMEN',
  egitmen: 'EĞİTMEN',
  hoca: 'EĞİTMEN',
  'öğretmen': 'EĞİTMEN',
  ogretmen: 'EĞİTMEN',
  teacher: 'EĞİTMEN',
  instructor: 'EĞİTMEN',
};

function speakerOf(v: unknown): TranscriptSegment['speaker'] {
  if (v === 'ÖĞRENCİ' || v === 'EĞİTMEN' || v === 'DİĞER') return v;
  if (typeof v !== 'string') return null;
  return SPEAKER_WORDS[v.trim().toLocaleLowerCase('tr')] ?? null;
}

/** `SS:DD:ss(.mmm|,mmm)`, `DD:ss(.mmm)` ya da sayı → saniye. */
export function parseTime(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
  if (typeof v !== 'string') return null;
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(v.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0);
}

function push(out: TranscriptSegment[], t0: number, t1: number, speaker: TranscriptSegment['speaker'], text: string): void {
  let rest = text.replace(/\s+/g, ' ').trim();
  while (rest) {
    out.push({ t0: Math.round(t0 * 100) / 100, t1: Math.round(Math.max(t0, t1) * 100) / 100, speaker, text: rest.slice(0, MAX_TEXT) });
    rest = rest.slice(MAX_TEXT).trim();
  }
}

/** Satır başındaki "ÖĞRENCİ:" / "Hoca:" konuşmacı önekini ayırır. */
function splitSpeaker(line: string): { speaker: TranscriptSegment['speaker']; text: string } {
  const m = /^\s*([\p{L}]+)\s*:\s*(.*)$/u.exec(line);
  const sp = m ? speakerOf(m[1]) : null;
  return sp && m ? { speaker: sp, text: m[2] ?? '' } : { speaker: null, text: line };
}

/**
 * Hazır transkript: JSON (`{segments:[{t|t0|start, t_end|t1|end, speaker?, text}]}` ya da dizi), WebVTT/SRT
 * (`00:00:01,000 --> 00:00:03,500`), düz metin (satır başına bir bölüm; zaman yoksa sıra numarası saniye sayılır).
 */
export function parseTranscriptFile(body: Buffer | string, hint: { mime?: string | null; path?: string | null } = {}): TranscriptSegment[] {
  const text = (typeof body === 'string' ? body : body.toString('utf8')).replace(/^\uFEFF/, '');
  const out: TranscriptSegment[] = [];
  const trimmed = text.trim();
  if (/json/i.test(hint.mime ?? '') || /\.json$/i.test(hint.path ?? '') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      data = null;
    }
    const segs = Array.isArray(data) ? data : data && typeof data === 'object' ? (data as { segments?: unknown }).segments : null;
    if (Array.isArray(segs)) {
      segs.forEach((s, i) => {
        if (!s || typeof s !== 'object') return;
        const o = s as Record<string, unknown>;
        const t0 = parseTime(o.t0 ?? o.t ?? o.start) ?? i;
        const t1 = parseTime(o.t1 ?? o.t_end ?? o.end) ?? t0;
        const sp = speakerOf(o.speaker);
        if (typeof o.text === 'string') push(out, t0, t1, sp, o.text);
      });
      return out;
    }
  }
  const cue = /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})/;
  if (cue.test(text)) {
    for (const block of text.split(/\r?\n\s*\r?\n/)) {
      const lines = block.split(/\r?\n/);
      const i = lines.findIndex((l) => cue.test(l));
      if (i < 0) continue;
      const m = cue.exec(lines[i]!)!;
      // WebVTT ses etiketi (`<v Hoca>`) konuşmacı önekine çevrilir, kalan biçim etiketleri atılır
      const body2 = lines.slice(i + 1).join(' ').trim().replace(/^<v\s+([^>]+)>/, '$1: ').replace(/<[^>]+>/g, '').trim();
      const { speaker, text: t } = splitSpeaker(body2);
      push(out, parseTime(m[1]) ?? 0, parseTime(m[2]) ?? 0, speaker, t);
    }
    return out;
  }
  text.split(/\r?\n/).filter((l) => l.trim()).forEach((line, i) => {
    const tm = /^\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+(.*)$/.exec(line);
    const t0 = tm ? parseTime(tm[1]) ?? i : i;
    const { speaker, text: t } = splitSpeaker(tm ? tm[2]! : line);
    push(out, t0, t0, speaker, t);
  });
  return out;
}

/**
 * Modelin pencere çıktısını girdideki bölümlere hizalar: sayı eşitse sırayla; değilse aynı başlangıç zamanının
 * (SS:DD:ss) sıradaki eşleşmesiyle. Eşleşmeyen bölüm etiketsiz (null) kalır.
 */
export function alignLabels(
  input: readonly { t0: number }[],
  output: readonly { t: string; speaker: 'ÖĞRENCİ' | 'EĞİTMEN' }[],
  hms: (sec: number) => string,
): { speakers: ('ÖĞRENCİ' | 'EĞİTMEN' | null)[]; matched: number } {
  if (output.length === input.length) return { speakers: output.map((o) => o.speaker), matched: input.length };
  const speakers: ('ÖĞRENCİ' | 'EĞİTMEN' | null)[] = input.map(() => null);
  let j = 0;
  let matched = 0;
  for (let i = 0; i < input.length && j < output.length; i++) {
    const t = hms(input[i]!.t0);
    let k = j;
    while (k < output.length && output[k]!.t < t) k++;
    if (k < output.length && output[k]!.t === t) {
      speakers[i] = output[k]!.speaker;
      matched++;
      j = k + 1;
    }
  }
  return { speakers, matched };
}
