// Eğitmen "Sınavlar" sayfası: instructor_exam_list / instructor_exam_keys (0048) yanıtlarının ayrıştırılması, sınav
// türünün Türkçe adı ve kaydetme eyleminin anahtar farkı (set_exam_keys'e giden satırlar). Saf modül (sunucu ve testler).

export type ExamKind = 'deneme' | 'diagnostic' | 'practice' | 'published';

export const EXAM_KIND_LABELS: Record<ExamKind, string> = {
  deneme: 'Deneme',
  diagnostic: 'Teşhis testi',
  practice: 'Pratik seti',
  published: 'Yayımlanmış deneme',
};

export function examKindLabel(kind: string): string {
  return (EXAM_KIND_LABELS as Record<string, string>)[kind] ?? kind;
}

/** set_exam_keys'in kabul ettiği şıklar (secure.exam_answer_keys.correct_option denetimi). */
export const KEY_OPTIONS = ['A', 'B', 'C', 'D', 'E'] as const;

export interface ExamListRow {
  id: string;
  title: string;
  kind: string;
  createdAt: string;
  questionCount: number;
  sessionCount: number;
  missingKeys: number;
  unverifiedKeys: number;
  canEdit: boolean;
  locked: boolean;
}

export interface ExamKeyQuestion {
  no: number;
  section: string | null;
  kind: 'mcq' | 'numeric' | 'open';
  skillIds: string[];
  optionKeys: string[];
  correctOption: string | null;
  numericValue: number | null;
  source: string | null;
  confidence: number | null;
  unverified: boolean;
}

export interface ExamKeys {
  exam: { id: string; title: string; kind: string; isCopyrighted: boolean; canEdit: boolean; locked: boolean };
  questions: ExamKeyQuestion[];
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : [];
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** instructor_exam_list yanıtı: dizi değilse hata atar (callRpc OGR-WEB-001'e çevirir). */
export function parseExamList(raw: unknown): ExamListRow[] {
  if (!Array.isArray(raw)) throw new Error('dizi bekleniyordu');
  return arr(raw)
    .filter((x) => str(x.id))
    .map((x) => ({
      id: str(x.id) as string,
      title: str(x.title) ?? 'Adsız sınav',
      kind: str(x.kind) ?? '',
      createdAt: str(x.created_at) ?? '',
      questionCount: num(x.question_count),
      sessionCount: num(x.session_count),
      missingKeys: num(x.missing_keys),
      unverifiedKeys: num(x.unverified_keys),
      canEdit: x.can_edit === true,
      locked: x.locked === true,
    }));
}

/** instructor_exam_keys yanıtı. */
export function parseExamKeys(raw: unknown): ExamKeys {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('nesne bekleniyordu');
  const r = raw as Record<string, unknown>;
  const e = (typeof r.exam === 'object' && r.exam !== null ? r.exam : {}) as Record<string, unknown>;
  const id = str(e.id);
  if (!id) throw new Error('sınav kimliği yok');
  return {
    exam: {
      id,
      title: str(e.title) ?? 'Adsız sınav',
      kind: str(e.kind) ?? '',
      isCopyrighted: e.is_copyrighted === true,
      canEdit: e.can_edit === true,
      locked: e.locked === true,
    },
    questions: arr(r.questions).map((q) => {
      const kind = q.kind === 'numeric' || q.kind === 'open' ? q.kind : 'mcq';
      return {
        no: num(q.no),
        section: str(q.section),
        kind,
        skillIds: strArr(q.skill_ids),
        optionKeys: strArr(q.option_keys),
        correctOption: str(q.correct_option),
        numericValue: numOrNull(q.numeric_value),
        source: str(q.source),
        confidence: numOrNull(q.confidence),
        unverified: q.unverified === true,
      };
    }),
  };
}

/** Çoktan seçmeli soru için seçilebilir şıklar: sorunun A–E içindeki şıkları, yoksa A–E. */
export function optionChoices(q: Pick<ExamKeyQuestion, 'optionKeys'>): string[] {
  const own = q.optionKeys.map((k) => k.trim().toUpperCase()).filter((k): k is string => (KEY_OPTIONS as readonly string[]).includes(k));
  return own.length > 0 ? Array.from(new Set(own)) : [...KEY_OPTIONS];
}

export const KEY_SOURCE_LABELS: Record<string, string> = {
  uploaded: 'yüklenen anahtar',
  inferred: 'model çıkarımı',
  instructor: 'eğitmen',
  generated: 'üretim',
};

export type KeyDiffEntry = { no: number; correct_option: string } | { no: number; numeric_value: number };

export interface KeyFormValue {
  /** Formdaki değer (şık harfi ya da sayı metni); boş: anahtar seçilmedi. */
  value: string;
  /** Doğrulanmamış anahtarı değiştirmeden "doğru" diye onayladı mı. */
  confirmed: boolean;
}

/**
 * Kaydet: yalnız değişen anahtarlar ve onaylanan doğrulanmamış anahtarlar set_exam_keys'e gider (kaynak 'instructor'
 * olur, doğrulanmamış işareti düşer). Açık uçlu sorular, boş bırakılan ve geçersiz değerler atlanır; geçersiz
 * değerlerin numaraları `invalid`'de döner.
 */
export function buildKeyDiff(questions: ExamKeyQuestion[], form: Map<number, KeyFormValue>): { keys: KeyDiffEntry[]; invalid: number[] } {
  const keys: KeyDiffEntry[] = [];
  const invalid: number[] = [];
  for (const q of questions) {
    const f = form.get(q.no);
    if (!f || q.kind === 'open') continue;
    const raw = f.value.trim();
    if (q.kind === 'mcq') {
      if (raw === '') continue;
      const opt = raw.toUpperCase();
      if (!(KEY_OPTIONS as readonly string[]).includes(opt)) {
        invalid.push(q.no);
        continue;
      }
      if (opt !== q.correctOption || (f.confirmed && q.unverified)) keys.push({ no: q.no, correct_option: opt });
    } else {
      if (raw === '') continue;
      const n = Number(raw.replace(',', '.'));
      if (!Number.isFinite(n)) {
        invalid.push(q.no);
        continue;
      }
      if (n !== q.numericValue || (f.confirmed && q.unverified)) keys.push({ no: q.no, numeric_value: n });
    }
  }
  return { keys, invalid };
}

/** Kaydet sonrası sayfaya dönen durum kodu (?durum=…) → ileti; [id]/page.tsx gösterir. */
export const SAVE_MESSAGES: Record<string, string> = {
  kaydedildi: 'Anahtar kaydedildi.',
  degisiklik_yok: 'Değişiklik yok; kaydedilecek bir şey bulunamadı.',
  gecersiz: 'Bazı cevaplar geçersiz; şık A–E, sayısal cevap sayı olmalı.',
  kilitli: 'Bu sınavın notlanmış oturumu var; anahtar artık değiştirilemez.',
  yetki: 'Bu sınavın anahtarını yalnız sınavın eğitmeni ya da admin değiştirebilir.',
  hata: 'Anahtar kaydedilemedi. Biraz sonra yeniden dene.',
};
