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
