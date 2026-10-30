/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/diagnostic-test.schema.json */

export type SkillId = string;
export type Probability = number;
export type OptionKey = "A" | "B" | "C" | "D";
export type Tag = string;
/**
 * Tam dört şık, anahtarlar sırayla A, B, C, D (yinelenen, eksik ya da sırası bozuk anahtar düşer; Telegram A·B·C·D düğmeleri ve grade_attempt aynı sırayı varsayar). En az iki şık misconception_tag=null taşır (doğru şık + en az bir etiketsiz çeldirici).
 *
 * @minItems 4
 * @maxItems 4
 */
export type Options = {
  key: OptionKey;
  text: string;
  /**
   * Yanlış şıkkın kodladığı yanılgı. DOĞRU ŞIK BU DİZİDEN ÇIKARILAMAZ: doğru şık null taşır VE en az bir çeldirici de null taşır (en az iki null zorunlu); LLM ve öğrenci yolu şıkları app.strip_tags ile etiketsiz görür.
   */
  misconception_tag: null | Tag;
}[];
/**
 * Teşhis testi madde listesi (diagnostic/items.json): 15–20 madde, sabit sıra, her madde 4 şık. Doğru şık alanı (correct) TANIMSIZDIR ve additionalProperties:false olduğundan anahtar bu dosyaya sızamaz.
 *
 * @minItems 15
 * @maxItems 20
 */
export type DiagnosticTest = Item[];

export interface Item {
  code: string;
  /**
   * @minItems 1
   * @maxItems 3
   */
  skill_ids: SkillId[];
  difficulty: Probability;
  /**
   * Teşhis maddeleri A–D şıklıdır
   */
  kind: "mcq";
  stem: string;
  stem_values?: {
    [k: string]: (number | string) | undefined;
  };
  figure: null | Figure;
  options: Options;
}
/**
 * Önceden render edilmiş şekil (diagnostic/figures/*.png + üreten .py, seed=2026)
 */
export interface Figure {
  tool: "matplotlib" | "svg" | "template";
  png_path: string;
  source_path?: string;
  /**
   * Şekli kelimelerle anlatır (Telegram altyazısı)
   */
  alt_text: string;
}
