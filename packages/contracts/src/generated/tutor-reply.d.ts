/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/tutor-reply.schema.json */

export type Probability = number;
export type SkillId = string;
export type Tag = string;

/**
 * Sohbetin yapılandırılmış çıktısı (zincir chat). Sunucu used_fact_ids ve detected_skill_ids'i doğrular.
 */
export interface TutorReply {
  /**
   * En çok 4 satır; emoji ve ünlem yok; yalnız **kalın** ve `kod`
   */
  reply: string;
  ends_with_question: boolean;
  hint_level?: number;
  confidence: Probability;
  escalate: boolean;
  escalate_reason: null | ("bot_unsure" | "grade_attendance_payment" | "human_requested");
  /**
   * @maxItems 2
   */
  detected_skill_ids: SkillId[];
  detected_misconception_tag: null | Tag;
  /**
   * Gerçekten kullanılan olgu numaraları; sunucu bilinmeyen id'yi atar
   */
  used_fact_ids: number[];
  /**
   * @maxItems 3
   */
  suggested_buttons?: ("hint" | "show_solution" | "ask_instructor" | "skip" | "continue")[];
  /**
   * Cevap genel bir açıklamaysa content_pool adayı
   */
  suggest_pool_save: boolean;
}
