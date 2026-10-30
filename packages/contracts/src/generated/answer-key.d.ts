/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/answer-key.schema.json */

export type Uuid = string;
export type OptionKey = "A" | "B" | "C" | "D";

/**
 * Cevap anahtarı: yalnız pipeline/seed ↔ register_answer_key. Worker bu şemayı içe almaz; secure.answer_keys satırının sözleşmesi.
 */
export interface AnswerKey {
  question_id: Uuid;
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
