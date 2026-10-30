/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/instructor-alert.schema.json */

/**
 * students.public_ref; ad ve uuid asla
 */
export type StudentRef = string;
export type DateTime = string;
export type Uuid = string;

/**
 * Eğitmen paneli alarmı (instructor_alerts). Tek cümle, yargısız; şiddet panelde kelimeyle gösterilir.
 */
export interface InstructorAlert {
  schema_version: "1.0";
  kind: "unanswered" | "silent" | "morale" | "deadline" | "response" | "ops";
  /**
   * Panelde kelimeyle: Acil / Dikkat / Bilgi
   */
  severity: "danger" | "warning" | "neutral";
  student_ref: null | StudentRef;
  staff_ref?: string | null;
  /**
   * Tek cümle; cevapsız soruda sorunun kendisi tırnak içinde; yargı yok ('göstergesi düştü')
   */
  detail: string;
  since: DateTime;
  ref: {
    message_id?: number;
    fact_id?: number;
    escalation_id?: Uuid;
    lesson_id?: Uuid;
    /**
     * ops alarmları (grup başına tekil)
     */
    chat_id?: number;
    /**
     * ops: exam_sources OCR hatası
     */
    source_id?: string;
  };
}
