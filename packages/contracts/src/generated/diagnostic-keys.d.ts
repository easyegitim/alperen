/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/diagnostic-keys.schema.json */

export type OptionKey = "A" | "B" | "C" | "D";

/**
 * Teşhis cevap anahtarları (diagnostic/answer-keys.json): {madde kodu: anahtar}. Yalnız seed-keys.py okur; Worker ve LLM yolu içe almaz.
 */
export interface DiagnosticKeys {
  [k: string]: Key | undefined;
}
export interface Key {
  correct_option: OptionKey;
  /**
   * SymPy ifadesi; validate.py correct_option metnini verdiğini doğrular
   */
  canonical_expr?: string;
  numeric_value?: string;
  numeric_tolerance?: number;
  solution: string;
}
