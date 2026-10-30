/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/models.schema.json */

export type Date = string;
/**
 * Denenme sırasıyla model adları (models anahtarları)
 *
 * @minItems 1
 */
export type Chain = string[];
export type Usd = number;

/**
 * Sağlayıcı, model, fiyat, limit ve zincir tablosu (models.json; tek kaynak, verified_at zorunlu). Kod model adı içermez, zincir adı kullanır. Ücretsiz Gemini katmanı trains_on_data=true beyan etmek zorundadır (aydınlatma metni bunu yazar).
 */
export interface ModelsConfig {
  $schema?: string;
  verified_at: Date;
  currency: "USD";
  note?: string;
  providers: {
    [k: string]: Provider | undefined;
  };
  models: {
    [k: string]: Model | undefined;
  };
  chains: {
    chat: Chain;
    chat_free_only: Chain;
    nightly_facts: Chain;
    weekly_summary: Chain;
    question_gen: Chain;
    vision_check: Chain;
    ocr: Chain;
    lesson_analysis: Chain;
    transcribe: Chain;
    diarize: Chain;
    query_expand: Chain;
    research: Chain;
    embedding: Chain;
  };
  cost_rules: {
    chat_budget_tokens_in: number;
    chat_turn_max_usd: Usd;
    chat_target_usd: Usd;
  };
}
export interface Provider {
  kind: "gemini" | "openai-compatible" | "workers-ai" | "anthropic" | "fake";
  base?: string;
  rest_base?: string;
  binding?: string;
  key_env?: string;
  tier: "free" | "paid";
  rpd?: number;
  neurons_per_day?: number;
  /**
   * Gönderilen veri sağlayıcının ürün eğitiminde kullanılabilir mi
   */
  trains_on_data?: boolean;
  enabled?: boolean;
}
export interface Model {
  provider: string;
  /**
   * 1M giriş token başına USD
   */
  in_per_m?: number;
  /**
   * 1M çıkış token başına USD
   */
  out_per_m?: number;
  batch_discount?: number;
  ctx?: number;
  structured?: boolean;
  vision?: boolean;
  audio?: boolean;
  dims?: number;
  /**
   * @minItems 1
   */
  use?: (
    | "chat"
    | "nightly_facts"
    | "weekly_summary"
    | "question_gen"
    | "vision_check"
    | "ocr"
    | "lesson_analysis"
    | "transcribe"
    | "diarize"
    | "research"
    | "embedding"
    | "query_expand"
    | "tts"
  )[];
  per_audio_hour?: number;
  neurons_per_1k_tokens?: number;
  enabled?: boolean;
}
