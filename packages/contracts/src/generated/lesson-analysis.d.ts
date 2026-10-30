/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/lesson-analysis.schema.json */

export type Uuid = string;
/**
 * students.public_ref; ad ve uuid asla
 */
export type StudentRef = string;
export type SkillId = string;
export type Probability = number;
export type Speaker = "ÖĞRENCİ" | "EĞİTMEN";
/**
 * HH:MM:SS
 */
export type Ts = string;
export type Tag = string;
export type Date = string;
export type Usd = number;

/**
 * Ders videosu analizi (güçlü model, şema zorunlu). Her kazanım iddiası zaman damgalı alıntıyla gelir; adlar yerine ÖĞRENCİ/EĞİTMEN etiketi.
 */
export interface LessonAnalysis {
  schema_version: "1.0";
  lesson_ref: Uuid;
  student_ref: StudentRef;
  duration_min?: number;
  skills: {
    skill_id: SkillId;
    mastery_estimate: Probability;
    confidence: Probability;
    /**
     * Kanıtsız kazanım geçersiz
     *
     * @minItems 1
     * @maxItems 5
     */
    evidence: TimedQuote[];
  }[];
  questions: {
    t: Ts;
    quote: string;
    skill_id?: null | SkillId;
    answered?: boolean;
  }[];
  hesitations: {
    t: Ts;
    kind: "said_dont_understand" | "long_silence" | "wrong_answer" | "asked_repeat";
    quote?: string;
    skill_id?: null | SkillId;
  }[];
  misconceptions: {
    /**
     * Katalogdaki etiket; yoksa null ve metin serbest
     */
    tag?: null | Tag;
    skill_id: SkillId;
    text_instructor: string;
    text_student: string;
    resolved_in_lesson?: boolean;
    /**
     * @minItems 1
     */
    evidence: TimedQuote[];
  }[];
  commitments: {
    who: Speaker;
    kind: "homework" | "promise" | "deadline";
    text: string;
    due?: null | Date;
    t: Ts;
  }[];
  talk: {
    student_ratio: Probability;
    student_questions: number;
    attention: "low" | "medium" | "high";
    morale: "low" | "medium" | "high" | "unknown";
    notes?: string;
  };
  /**
   * seed_profile'daki açık yanılgılar için
   */
  previous_profile_check: {
    misconception_id: Uuid;
    status: "still_present" | "improved" | "not_observed";
    evidence?: TimedQuote[];
  }[];
  next_step: {
    for_student: string;
    for_instructor: string;
  };
  model_notes: {
    model: string;
    prompt_version: string;
    cost_usd: Usd;
    tokens_in: number;
    tokens_out: number;
    frames?: number;
  };
}
export interface TimedQuote {
  speaker: Speaker;
  /**
   * Alıntı; ad içermez
   */
  quote: string;
  t: Ts;
  t_end?: Ts;
}
