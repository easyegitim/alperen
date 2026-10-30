/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/exam-priority-plan.schema.json */

export type SkillId = string;
export type Uuid = string;
export type DateTime = string;

/**
 * Kalem (b) çıktısı: geçmiş sınavların sıklık analizine göre öncelikler. Tahmin değildir; soru metni taşımaz.
 */
export interface ExamPriorityPlan {
  schema_version: "1.0";
  course_code: string;
  period: string;
  title: "Sıklık analizine göre öncelikler";
  years_total: number;
  /**
   * @minItems 1
   * @maxItems 10
   */
  rows: {
    rank: number;
    topic: string;
    kind: "ispat" | "hesap" | "çoktan seçmeli" | "diğer";
    skill_id?: null | SkillId;
    hits: number;
    years: number;
    points_text: string;
    evidence_count: number;
    /**
     * Eğitmen arşivine bağlantı; soru metni yok
     *
     * @minItems 1
     */
    evidence_item_ids: Uuid[];
    syllabus_alignment: "covered_and_asked" | "covered_never_asked" | "asked_not_in_syllabus";
    /**
     * ÖZGÜN varyantlar (questions.source='llm', approved)
     */
    variant_question_ids?: Uuid[];
  }[];
  others: string[];
  /**
   * İzlencede var, hiç sorulmamış
   */
  uncovered_topics?: string[];
  evidence_count: number;
  generated_at: DateTime;
}
