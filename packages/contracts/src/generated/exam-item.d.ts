/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/exam-item.schema.json */

export type Uuid = string;
export type SkillId = string;
export type Probability = number;

/**
 * Sınav arşivinden OCR ile çıkarılmış tek soru (exam_items). ocr_text hiçbir öğrenci çıktısına kopyalanmaz.
 */
export interface ExamItem {
  schema_version: "1.0";
  source_id: Uuid;
  item_no: number;
  topic: string;
  kind: "proof" | "calc" | "mc" | "other";
  points?: number | null;
  year: number;
  term?: null | ("vize" | "final" | "but" | "deneme" | "osym" | "diger");
  instructor_alias?: string | null;
  skill_id?: null | SkillId;
  /**
   * Yalnız eğitmen arşivi ve kümeleme; hiçbir öğrenci çıktısına kopyalanmaz
   */
  ocr_text: string;
  ocr_confidence?: Probability;
}
