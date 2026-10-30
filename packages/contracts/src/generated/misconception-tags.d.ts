/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/misconception-tags.schema.json */

export type CommonTag = string;
export type SkillId = string;
/**
 * Yanılgı etiketi kataloğu (misconception-tags.json): dizi; her etiket eğitmen metni (üçüncü tekil) ve öğrenci metni (sen dili, ünlemsiz) taşır. skill_id null olan etiketler yalnız genel.* önekli olabilir.
 *
 * @minItems 1
 */
export type MisconceptionTags = Tag[];

export interface Tag {
  tag: CommonTag;
  /**
   * null = çok kazanımlı genel etiket (genel.*)
   */
  skill_id: null | SkillId;
  /**
   * 'Asıl sorun alt konuda' çıkarımı için ön koşul
   */
  prereq_skill_id: null | SkillId;
  /**
   * Üçüncü tekil, ünlemsiz, emojisiz (desen ! ve emoji aralıklarını reddeder)
   */
  text_instructor: string;
  /**
   * Sen dili, ünlemsiz, emojisiz (desen ! ve emoji aralıklarını reddeder)
   */
  text_student: string;
}
