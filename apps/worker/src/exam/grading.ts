/**
 * Anahtar, optik form ve net hesabı (saf işlevler). Notlamanın kendisi SQL'dedir (`grade_exam_session`); buradaki
 * `expectedScore` aynı kuralları uygular ve hattın SQL sonucunu çapraz denetlemesi ile testler içindir:
 *   boş/çift işaret/okunamayan → boş; son işaretli sorudan sonraki boşlar → yetişmedi (unfinished); anahtarsız ya da
 *   açık uçlu → notlanmaz; net = doğru − yanlış × ceza (ÖSYM 0,25: dört yanlış bir doğruyu götürür).
 */
import type { AnswerSheet, InferredKeys } from '@ogrenmen/contracts';

/**
 * Anahtar güveni bunun altındaysa "anahtar doğrulanmadı" (PLAN-v2 §8). SQL'deki eşikle aynı: set_exam_keys.unverified,
 * score.unverified_keys (0030: `coalesce(k.confidence, 0) < 0.8`); değişirse ikisi birlikte.
 */
export const KEY_LOW_CONFIDENCE = 0.8;
/** Optik satır güveni bunun altındaysa uyarı (eğitmen bakar). */
export const ANSWER_LOW_CONFIDENCE = 0.6;
export const WRONG_PENALTY = 0.25;

export type QuestionKind = 'mcq' | 'numeric' | 'open';

export interface KeyedQuestion {
  no: number;
  kind: QuestionKind;
  optionKeys: readonly string[];
}

export interface KeyRow {
  no: number;
  correct_option: string | null;
  numeric_value: number | null;
  confidence: number | null;
}

export interface AnswerRow {
  no: number;
  /** Notlanacak cevap (tek işaret); boş, çift işaret ya da okunamayan satırda null. */
  answer: string | null;
  status: 'marked' | 'blank' | 'multiple' | 'unclear' | 'missing';
  marks_seen: string[];
  note: string | null;
  confidence: number;
}

/** Çıkarılmış anahtarı denetler: bilinmeyen soru, şıklarda olmayan cevap, türüne uymayan değer düşer. */
/** Anahtar adayı: model çıktısı ya da kaynaktaki (yayıncı, sayfa) anahtar; şık metni ve güven bilinmeyebilir. */
export interface KeyCandidate {
  question_no: number;
  correct_option: string | null;
  numeric_value: number | null;
  confidence?: number | null;
}

export function validateKeys(keys: readonly KeyCandidate[], questions: readonly KeyedQuestion[]): { keys: KeyRow[]; dropped: string[] } {
  const byNo = new Map(questions.map((q) => [q.no, q]));
  const out = new Map<number, KeyRow>();
  const dropped: string[] = [];
  for (const k of keys) {
    const q = byNo.get(k.question_no);
    if (!q) {
      dropped.push(`soru ${k.question_no} sınavda yok`);
      continue;
    }
    if (q.kind === 'open') continue;
    if (q.kind === 'mcq') {
      const opt = k.correct_option?.trim().toUpperCase() ?? null;
      if (!opt || !/^[A-E]$/.test(opt) || (q.optionKeys.length >= 2 && !q.optionKeys.includes(opt))) {
        dropped.push(`soru ${k.question_no}: şık ${k.correct_option ?? 'yok'} geçersiz`);
        continue;
      }
      out.set(q.no, { no: q.no, correct_option: opt, numeric_value: null, confidence: k.confidence ?? null });
    } else {
      if (k.numeric_value === null || !Number.isFinite(k.numeric_value)) {
        dropped.push(`soru ${k.question_no}: sayısal değer yok`);
        continue;
      }
      out.set(q.no, { no: q.no, correct_option: null, numeric_value: k.numeric_value, confidence: k.confidence ?? null });
    }
  }
  return { keys: [...out.values()].sort((a, b) => a.no - b.no), dropped };
}

/** Basılı cevap anahtarı sayfası (answer_sheet rotasıyla okunur): tek işaretli satır anahtardır. */
export function keysFromKeyPage(sheet: AnswerSheet): Pick<InferredKeys['keys'][number], 'question_no' | 'correct_option' | 'numeric_value' | 'confidence'>[] {
  return sheet.answers
    .filter((a) => a.status === 'marked' && a.marked_option !== null)
    .map((a) => ({ question_no: a.question_no, correct_option: a.marked_option, numeric_value: null, confidence: a.confidence }));
}

/** Bir ya da daha çok optik form sayfasını soru numarasına göre birleştirir; formda olmayan soru `missing` (boş). */
export function answersFromSheets(sheets: readonly AnswerSheet[], questionNos: readonly number[]): { answers: AnswerRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const rows = new Map<number, AnswerRow>();
  for (const sheet of sheets) {
    for (const a of sheet.answers) {
      const row: AnswerRow = {
        no: a.question_no,
        answer: a.status === 'marked' ? a.marked_option : null,
        status: a.status,
        marks_seen: [...a.marks_seen],
        note: a.note,
        confidence: a.confidence,
      };
      const prev = rows.get(a.question_no);
      if (prev && prev.status !== 'blank') {
        if (row.status !== 'blank' && row.answer !== prev.answer) warnings.push(`soru ${a.question_no} iki formda farklı okundu`);
        continue;
      }
      rows.set(a.question_no, row);
    }
  }
  const nos = new Set(questionNos);
  for (const no of rows.keys()) if (!nos.has(no)) warnings.push(`formdaki ${no}. satırın kitapçıkta sorusu yok`);
  const answers = [...questionNos]
    .sort((a, b) => a - b)
    .map((no) => rows.get(no) ?? { no, answer: null, status: 'missing' as const, marks_seen: [], note: null, confidence: 0 });
  const double = answers.filter((a) => a.status === 'multiple').map((a) => a.no);
  const unclear = answers.filter((a) => a.status === 'unclear').map((a) => a.no);
  const low = answers.filter((a) => a.status === 'marked' && a.confidence < ANSWER_LOW_CONFIDENCE).map((a) => a.no);
  if (double.length) warnings.push(`çift işaret (boş sayıldı): ${double.join(', ')}`);
  if (unclear.length) warnings.push(`okunamayan işaret (boş sayıldı): ${unclear.join(', ')}`);
  if (low.length) warnings.push(`düşük güvenle okunan işaret: ${low.join(', ')}`);
  return { answers, warnings };
}

export type Outcome = 'correct' | 'wrong' | 'blank' | 'unfinished' | null;

export interface Score {
  total: number;
  correct: number;
  wrong: number;
  blank: number;
  unfinished: number;
  ungraded: number;
  net: number;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** grade_exam_session ile aynı kurallar (sayısal karşılaştırma 1e-6 toleranslı; ondalık virgül kabul). */
export function outcomes(questions: readonly KeyedQuestion[], keys: readonly KeyRow[], answers: readonly Pick<AnswerRow, 'no' | 'answer'>[]): Map<number, Outcome> {
  const keyBy = new Map(keys.map((k) => [k.no, k]));
  const ansBy = new Map(answers.map((a) => [a.no, a.answer?.trim().toUpperCase() || null]));
  const answeredNos = questions.filter((q) => ansBy.get(q.no)).map((q) => q.no);
  const last = answeredNos.length ? Math.max(...answeredNos) : null;
  const out = new Map<number, Outcome>();
  for (const q of questions) {
    const a = ansBy.get(q.no) ?? null;
    const k = keyBy.get(q.no);
    if (!a) out.set(q.no, last === null || q.no > last ? 'unfinished' : 'blank');
    else if (!k || q.kind === 'open') out.set(q.no, null);
    else if (q.kind === 'mcq') out.set(q.no, !/^[A-E]$/.test(a) ? 'blank' : a === k.correct_option ? 'correct' : 'wrong');
    else {
      const v = Number(a.replace(',', '.').replace(/^(-?\d+)\/(\d+)$/, (_m, p: string, d: string) => String(Number(p) / Number(d))));
      out.set(q.no, Number.isFinite(v) && k.numeric_value !== null && Math.abs(v - k.numeric_value) <= 1e-6 ? 'correct' : 'wrong');
    }
  }
  return out;
}

export function scoreOf(o: ReadonlyMap<number, Outcome>, penalty = WRONG_PENALTY): Score {
  const v = [...o.values()];
  const count = (x: Outcome) => v.filter((y) => y === x).length;
  const correct = count('correct');
  const wrong = count('wrong');
  return { total: v.length, correct, wrong, blank: count('blank'), unfinished: count('unfinished'), ungraded: count(null), net: round2(correct - penalty * wrong) };
}

export function expectedScore(questions: readonly KeyedQuestion[], keys: readonly KeyRow[], answers: readonly Pick<AnswerRow, 'no' | 'answer'>[], penalty = WRONG_PENALTY): Score {
  return scoreOf(outcomes(questions, keys, answers), penalty);
}

/** "5,5" / "27,25" / "10" (Türkçe ondalık). */
export function trNet(n: number): string {
  return String(round2(n)).replace('.', ',');
}
