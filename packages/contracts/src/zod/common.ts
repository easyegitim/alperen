/**
 * Ortak alan kalıpları: kimlikler, kazanım kodları, şıklar, zaman damgaları, kanıt alıntıları.
 * Her şema bunları kendi `build(c)` fabrikasında çağırır; kısıtlar yalnız loose kipte eklenir.
 */
import { z } from 'zod';
import type { Ctx } from './kit.js';

/** Kazanım kodu/kimliği: küçük harf, noktalı yol (`tyt.mat.temel.rasyonel-sayilar`); tek parça da olur. */
export const SKILL_CODE = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/;
/** Yanılgı etiketi: en az iki parça (`rasyonel.pay-payda-ayri-toplama`). */
export const TAG_CODE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
/** `students.public_ref`; ad ve uuid asla. */
export const STUDENT_REF = /^s_[a-z2-7]{12}$/;
/** HH:MM:SS. */
export const TIMESTAMP = /^[0-9]{2}:[0-9]{2}:[0-9]{2}$/;
/** Tarz kodu: küçük harf, rakam, tire. */
export const STYLE_CODE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Hafıza dosyası yolu (`app.memory_path_ok` ile aynı): `/memories/` altında en çok 3 düzey, `.md|.txt`; `..` ayrıca reddedilir. */
export const MEMORY_PATH = /^\/memories\/([A-Za-z0-9_-]+\/){0,2}[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(md|txt)$/;
/** Zorluk bandı: `question_styles.difficulty_band`, `exam-generation.difficulty` ve `style-definition` tek kaynaktan. */
export const DIFFICULTY_BANDS = ['easy', 'medium', 'hard'] as const;
export type DifficultyBand = (typeof DIFFICULTY_BANDS)[number];
/** `exam_questions.difficulty` (numeric 0..1) için tek kaynaklı eşleme: üretilen denemeler bandı bu sayıya çevirir. */
export const DIFFICULTY_BAND_VALUE = { easy: 0.3, medium: 0.55, hard: 0.8 } as const satisfies Record<DifficultyBand, number>;
/** Tarz/soru sunuş biçimi (`question_styles.format`, `exam_items.format`); cevap türü (`kind`) değildir. */
export const PRESENTATION_FORMATS = ['text', 'table', 'graph', 'geometry_figure', 'word_problem', 'other'] as const;

/**
 * Kodla üretilen figürün dili (document-ast `figure.kind`, exam-generation `items[].figure.kind`): `matplotlib` →
 * `figure_code` Python'dır (yalnız matplotlib/numpy/math; `figure_<n>.svg` yazar), `svg` → `figure_code` elle yazılmış
 * SVG metnidir (basit geometri). İkisinde de worker kodu çalıştırıp/temizleyip `svg`'yi doldurur.
 */
export const FIGURE_CODE_KINDS = ['matplotlib', 'svg'] as const;
export type FigureCodeKind = (typeof FIGURE_CODE_KINDS)[number];
/** Figür çıktı dosyasının adı: `figure_<n>.svg` (n 1'den başlar; code_execution konteynerinde ve yerel üretimde aynı). */
export const FIGURE_FILE = /^figure_([1-9][0-9]{0,2})\.svg$/;
export const figureFileName = (n: number): string => `figure_${n}.svg`;
/**
 * Koddaki figür dosya adı (yoksa null): önce `save_figure(<ad>, <n>)` çağrısının son eşleşmesi (promptların tek
 * yolu), sonra düz `figure_<n>.svg` metni. Uzak (code_execution) kipte indirilen dosyayı figüre bağlamak için sıradan önce bu kullanılır.
 */
export function figureFileFromCode(code: string): string | null {
  let last: string | null = null;
  for (const m of code.matchAll(/save_figure\(\s*[A-Za-z_]\w*\s*,\s*([1-9]\d{0,2})\s*\)/g)) last = m[1] ?? null;
  if (last) return figureFileName(Number(last));
  const m = /figure_([1-9][0-9]{0,2})\.svg/.exec(code);
  return m ? `figure_${m[1]}.svg` : null;
}

/**
 * Kişisel hata kutusunun (`common_mistake_callout.pattern_ref`) kaynağı: `patterns.md` (öğrencinin hafıza dosyasındaki
 * örüntü satırı), `misconception` (açık yanılgı kaydı, etiket kodu), `analysis` (tek bir teşhis/deneme analizi).
 */
export const PATTERN_SOURCES = ['patterns.md', 'misconception', 'analysis'] as const;
export type PatternSource = (typeof PATTERN_SOURCES)[number];

export const OPTION_KEYS_4 = ['A', 'B', 'C', 'D'] as const;
export const OPTION_KEYS_5 = ['A', 'B', 'C', 'D', 'E'] as const;
export const ERROR_CAUSES = ['concept', 'procedure', 'careless', 'reading', 'time'] as const;
export const VERDICTS = ['correct', 'wrong', 'incomplete', 'unreadable'] as const;
export const SPEAKERS = ['ÖĞRENCİ', 'EĞİTMEN'] as const;

export const skillCode = (c: Ctx, desc?: string) => c.str({ pattern: SKILL_CODE, desc });
export const tagCode = (c: Ctx, desc?: string) => c.str({ pattern: TAG_CODE, desc });
export const studentRef = (c: Ctx) => c.str({ pattern: STUDENT_REF, desc: 'students.public_ref; ad ve uuid asla' });
export const timestamp = (c: Ctx) => c.str({ pattern: TIMESTAMP, desc: 'HH:MM:SS' });
export const styleCode = (c: Ctx) => c.str({ min: 2, max: 60, pattern: STYLE_CODE });

export const optionKey4 = z.enum(OPTION_KEYS_4);
export const optionKey5 = z.enum(OPTION_KEYS_5);
export const speaker = z.enum(SPEAKERS);

/** Alıntılı kanıt (ders analizi): konuşmacı etiketi + alıntı + zaman. */
export const timedQuote = (c: Ctx) =>
  z.strictObject({
    speaker,
    quote: c.str({ min: 3, max: 300, desc: 'Alıntı; ad içermez' }),
    t: timestamp(c),
    t_end: timestamp(c).optional(),
  });

/** `{key, text}` şıkkı (deneme/belge); yanılgı etiketi taşımaz. */
export const plainOption = (c: Ctx, keys: z.ZodType<'A' | 'B' | 'C' | 'D' | 'E'> = optionKey5) =>
  z.strictObject({ key: keys, text: c.str({ min: 1, max: 600 }) });

/** Cevap anahtarı satırı (belge ve deneme için): şık ya da sayısal değer, tam biri dolu. */
export const keyEntryShape = (c: Ctx) => ({
  question_no: c.int({ min: 1, max: 500 }),
  correct_option: optionKey5.nullable().describe('MCQ ise doğru şık, değilse null'),
  numeric_value: c
    .num()
    .nullable()
    .describe('Sayısal soru ise ondalık değer (secure.exam_answer_keys.numeric_value numeric); grade_exam_session 1e-6 toleransla karşılaştırır. Değilse null'),
  canonical_expr: c
    .str({ max: 300 })
    .nullable()
    .describe("Kesin SymPy biçimi: sympy.sympify edilebilir ifade ('7/8', '2*sqrt(3)') ya da null"),
});

/** Anahtar satırında şık ile sayısal değerden tam biri dolu olmalı. */
export function exactlyOneKeyValue(entry: { correct_option: unknown; numeric_value: unknown }): boolean {
  return (entry.correct_option !== null) !== (entry.numeric_value !== null);
}
