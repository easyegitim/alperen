/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/bot-response-log.schema.json */

export type Uuid = string;
export type Usd = number;
export type Probability = number;

/**
 * Her bot cevabının kaydı (bot_responses; log_bot_response). Kayıt yoksa cevap yok; prompt_text temizlenmiş tam prompttur.
 */
export interface BotResponseLog {
  schema_version: "1.0";
  in_message_id?: number | null;
  chat_id: number;
  out_telegram_message_id?: number | null;
  purpose: "chat" | "feedback" | "hint" | "command" | "proactive" | "escalation" | "quota" | "consent" | "degraded";
  mode?: null | ("socratic" | "direct");
  prompt_version?: string | null;
  prompt_hash?: string | null;
  /**
   * TEMİZLENMİŞ tam prompt (sistem + bağlam + mesaj); 30 gün sonra null
   */
  prompt_text?: string | null;
  response_text: string;
  memory_fact_ids: number[];
  recent_message_ids: number[];
  pool_id?: null | Uuid;
  cache_hit: boolean;
  provider?: string | null;
  model?: string | null;
  provider_attempts: ProviderAttempt[];
  tokens_in?: number | null;
  tokens_out?: number | null;
  cost_usd: Usd;
  latency_ms: number;
  confidence?: null | Probability;
  escalated: boolean;
  schema_valid?: boolean | null;
  quota_state?: {
    used?: number;
    limit?: number;
  };
  degraded_mode: boolean;
  pii_replacements: number;
  guards?: (
    | "forbidden_topic"
    | "unsure"
    | "human_requested"
    | "quota"
    | "consent_missing"
    | "figure_unverified"
    | "format_fix"
    | "injection_suspect"
  )[];
}
export interface ProviderAttempt {
  provider: string;
  model: string;
  status: "ok" | "error" | "rate_limited" | "timeout" | "cap_blocked" | "cooldown_skip" | "bad_output";
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: Usd;
  latency_ms?: number;
  error_code?: string | null;
}
