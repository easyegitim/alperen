/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/question-generation.schema.json */

export type Uuid = string;
export type SkillId = string;
export type OptionKey = "A" | "B" | "C" | "D";
export type Tag = string;
export type Probability = number;
export type Value =
  | (
      | Leaf
      | {
          [k: string]: Leaf;
        }
    )
  | undefined;
export type Leaf = Scalar | Scalar[];
export type Scalar = number | string | boolean | null;
export type Usd = number;
export type DateTime = string;

/**
 * Tablet'in LLM'den istediği yapılandırılmış çıktı: tek zarfta item (question-item) ve key (answer-key, question_id hariç). Pipeline item'ı questions'a, key'i SymPy'den geçirip register_answer_key'e verir; key dosyaya yazılmaz.
 */
export interface QuestionGeneration {
  schema_version?: "1.0";
  item: QuestionItem;
  key: Key;
}
/**
 * Soru maddesi. Cevap anahtarı BU NESNEDE YOKTUR (answer-key ayrı sözleşmedir).
 */
export interface QuestionItem {
  schema_version: "1.0";
  id?: Uuid;
  curriculum_code: string;
  kind: "mcq" | "numeric";
  /**
   * @minItems 1
   * @maxItems 3
   */
  skill_ids: SkillId[];
  /**
   * Soru kökü; formüller düz metin/kod biçiminde; şekil varsa kök şekli kelimelerle de anlatır
   */
  stem: string;
  /**
   * Şekil denetiminin karşılaştırdığı değerler (kenar, açı, eksen)
   */
  stem_values?: {
    [k: string]: (number | string) | undefined;
  };
  figure: null | {
    tool: "matplotlib" | "svg" | "tikz" | "vega-lite" | "schemdraw" | "rdkit" | "graphviz" | "latex" | "template";
    code: string;
    /**
     * Şekli kelimelerle anlatır (Telegram altyazısı, alt)
     */
    alt_text: string;
    expected_px?: {
      min_w?: number;
      max_w?: number;
      min_h?: number;
      max_h?: number;
    };
    render?: {
      status?: "pending" | "rendered" | "failed";
      png_path?: string;
      width_px?: number;
      height_px?: number;
      bytes?: number;
      vision?: "pending" | "match" | "mismatch" | "not_applicable" | "skipped";
      attempts?: number;
    };
  };
  /**
   * Tam dört şık, anahtarlar sırayla A, B, C, D (yinelenen, eksik ya da sırası bozuk anahtar düşer; Telegram A·B·C·D düğmeleri ve grade_attempt aynı sırayı varsayar). En az iki şık misconception_tag=null taşır (doğru şık + en az bir etiketsiz çeldirici).
   *
   * @minItems 4
   * @maxItems 4
   */
  options?: {
    key: OptionKey;
    text: string;
    /**
     * Yanlış şıkkın kodladığı yanılgı. DOĞRU ŞIK BU DİZİDEN ÇIKARILAMAZ: doğru şık null taşır VE en az bir çeldirici de null taşır (en az iki null zorunlu); LLM ve öğrenci yolu şıkları app.strip_tags ile etiketsiz görür.
     */
    misconception_tag: null | Tag;
  }[];
  difficulty?: Probability;
  source: "template" | "llm" | "instructor" | "diagnostic";
  template?: {
    id?: string;
    /**
     * Şablon parametreleri (template-params ile aynı değer kuralı: sayı, metin, mantıksal, null, bunların düz dizisi ya da bir düzey düz nesne)
     */
    params?: {
      [k: string]: Value | undefined;
    };
  };
  verification: {
    schema: boolean;
    sympy: "verified" | "failed" | "not_applicable" | "pending";
    render: "ok" | "failed" | "size_mismatch" | "not_applicable" | "pending";
    vision: "match" | "mismatch" | "not_applicable" | "pending" | "skipped";
    attempts: number;
    status: "draft" | "pending_review" | "approved" | "rejected" | "retired";
    review_note?: string | null;
  };
  provenance?: {
    model?: string;
    cost_usd?: Usd;
    prompt_version?: string;
    prompt_hash?: string;
    created_at?: DateTime;
  };
}
/**
 * answer-key ile aynı alanlar, question_id hariç (soru henüz yazılmadı).
 */
export interface Key {
  correct_option?: OptionKey;
  /**
   * SymPy string: '7/8', '2*sqrt(3)'
   */
  numeric_value?: string;
  numeric_tolerance?: number;
  /**
   * sympy.sympify edilebilir ifade; stem_values ile çözülür
   */
  canonical_expr?: string;
  /**
   * Adım adım çözüm; doğrudan modda reveal_solution bunu döner
   */
  solution: string;
  sympy_status: "verified" | "failed" | "not_applicable";
  sympy_report?: {
    expr?: string;
    value?: string;
    matched_option?: string | null;
    note?: string;
  };
}
