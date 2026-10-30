/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/generation-request.schema.json */

export type Uuid = string;
export type SkillId = string;
export type DateTime = string;

/**
 * generation_requests satırı (boru hatları arası sözleşme tablosu): yalnız META taşır (kazanım, bant, konu, tür, puan). ocr_text/stem alanı TANIMSIZDIR ve additionalProperties:false olduğundan ham soru metni taşınamaz.
 */
export interface GenerationRequest {
  id?: Uuid;
  kind: "pool_miss" | "regenerate" | "exam_variant";
  curriculum_id?: Uuid;
  skill_id: SkillId;
  difficulty_band: "easy" | "mid" | "hard";
  /**
   * exam_variant: küme konusu (ham soru metni ASLA)
   */
  topic?: string | null;
  question_kind?: null | ("mcq" | "numeric");
  points?: number | null;
  plan_id?: null | Uuid;
  requested_by?: null | Uuid;
  requested_by_staff?: null | Uuid;
  served_question_id?: null | Uuid;
  served_at?: null | DateTime;
  needs_generation?: boolean;
  created_at?: DateTime;
}
