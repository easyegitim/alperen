/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/curriculum.schema.json */

export type SkillId = string;

/**
 * Müfredat sürümünün birleşik doğrulaması: curriculum.json + skills.json + prerequisites.json tek nesnede ({curriculum, skills, prerequisites}). Tekil dosyalar $defs ile doğrulanabilir (curriculum#/$defs/skill vb.).
 */
export interface CurriculumBundle {
  schema_version?: "1.0";
  curriculum: Curriculum;
  /**
   * @minItems 1
   */
  skills: Skill[];
  prerequisites: Prerequisite[];
}
/**
 * curriculum.json (curricula satırı + dönem + teşhis istisnaları)
 */
export interface Curriculum {
  schema_version?: "1.0";
  code: string;
  authority: "MEB" | "ÖSYM" | "UNI" | "OTHER";
  year: number;
  version: string;
  label: string;
  /**
   * Zorunlu; export-sql.py curricula.status olarak aynen yazar
   */
  status: "draft" | "active" | "retired";
  /**
   * settings.default_period ile aynı (ör. 'YKS 2027')
   */
  period_label?: string;
  sources?: string[];
  /**
   * Teşhis maddesi olmayan, pratikte ölçülen yapraklar
   */
  diagnostic_exempt?: SkillId[];
}
/**
 * skills.json öğesi (skills satırı)
 */
export interface Skill {
  id: SkillId;
  parent_id: null | SkillId;
  name: string;
  description?: string | null;
  /**
   * Düğüm kazanımlar (false) mastery tutmaz
   */
  is_leaf: boolean;
  order_no?: number;
  p_init?: number;
  p_learn?: number;
  p_guess?: number;
  p_slip?: number;
}
/**
 * prerequisites.json öğesi (skill_prerequisites satırı)
 */
export interface Prerequisite {
  skill_id: SkillId;
  prereq_id: SkillId;
  strength: number;
  source?: "curriculum" | "instructor" | "inferred";
}
