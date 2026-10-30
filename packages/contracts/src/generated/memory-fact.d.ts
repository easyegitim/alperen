/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/memory-fact.schema.json */

/**
 * students.public_ref; ad ve uuid asla
 */
export type StudentRef = string;
export type Probability = number;
export type Date = string;
export type SkillId = string;

/**
 * Gece olgu çıkarımının tek olgusu (memory_facts satırı). Kaynak mesaj numarası zorunlu; ad içermez.
 */
export interface MemoryFact {
  schema_version: "1.0";
  student_ref: StudentRef;
  kind:
    | "promise"
    | "deadline"
    | "unanswered_question"
    | "morale"
    | "topic_asked"
    | "preference"
    | "instructor_fact"
    | "other";
  /**
   * İsim yok; 'öğrenci' veya 'eğitmen' der; üçüncü tekil
   */
  text: string;
  /**
   * messages.id — kaynak zorunlu; günün mesajları arasında olmalı (pipeline doğrular)
   *
   * @minItems 1
   * @maxItems 8
   */
  source_message_ids: number[];
  confidence: Probability;
  valid_until?: null | Date;
  morale_signal?: number | null;
  /**
   * not/devamsızlık/puan/ödeme içeriyorsa true; bot approved olmadan kullanmaz
   */
  requires_approval: boolean;
  skill_id?: null | SkillId;
}
