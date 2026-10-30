/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/weekly-summary.schema.json */

/**
 * students.public_ref; ad ve uuid asla
 */
export type StudentRef = string;
export type Date = string;
export type Probability = number;
export type SkillId = string;

/**
 * Haftalık öğrenci özeti (Katman 3): üçüncü tekil, isimsiz; metrikler SQL/Python'dan, LLM yalnız metni yazar.
 */
export interface WeeklySummary {
  schema_version: "1.0";
  student_ref: StudentRef;
  week_start: Date;
  /**
   * 3–6 cümle, üçüncü tekil, isimsiz: ne çalıştı, nerede takıldı, ne söz verdi, moral
   */
  body: string;
  metrics: {
    messages: number;
    questions_solved: number;
    accuracy: null | Probability;
    active_days: number;
    open_misconceptions: number;
    unanswered_questions: number;
    morale_trend: "up" | "flat" | "down" | "unknown";
    mastery_deltas?: {
      skill_id: SkillId;
      delta: number;
      reliable?: boolean;
    }[];
  };
  facts_used: number[];
  /**
   * @maxItems 3
   */
  next_week_focus?: SkillId[];
}
