/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/common.schema.json */

/**
 * This interface was referenced by `Common`'s JSON-Schema
 * via the `definition` "uuid".
 */
export type Uuid = string;
/**
 * This interface was referenced by `Common`'s JSON-Schema
 * via the `definition` "dateTime".
 */
export type DateTime = string;
/**
 * This interface was referenced by `Common`'s JSON-Schema
 * via the `definition` "date".
 */
export type Date = string;
/**
 * students.public_ref; ad ve uuid asla
 *
 * This interface was referenced by `Common`'s JSON-Schema
 * via the `definition` "studentRef".
 */
export type StudentRef = string;
/**
 * This interface was referenced by `Common`'s JSON-Schema
 * via the `definition` "skillId".
 */
export type SkillId = string;
/**
 * This interface was referenced by `Common`'s JSON-Schema
 * via the `definition` "tag".
 */
export type Tag = string;
/**
 * This interface was referenced by `Common`'s JSON-Schema
 * via the `definition` "probability".
 */
export type Probability = number;
/**
 * This interface was referenced by `Common`'s JSON-Schema
 * via the `definition` "usd".
 */
export type Usd = number;
/**
 * This interface was referenced by `Common`'s JSON-Schema
 * via the `definition` "speaker".
 */
export type Speaker = "ÖĞRENCİ" | "EĞİTMEN";
/**
 * HH:MM:SS
 *
 * This interface was referenced by `Common`'s JSON-Schema
 * via the `definition` "ts".
 */
export type Ts = string;
/**
 * This interface was referenced by `Common`'s JSON-Schema
 * via the `definition` "optionKey".
 */
export type OptionKey = "A" | "B" | "C" | "D";

/**
 * Ortak tanımlar: kimlikler, zaman, olasılık, konuşmacı, kanıt ve sağlayıcı denemesi. Diğer şemalar $ref ile kullanır.
 */
export interface Common {
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `Common`'s JSON-Schema
 * via the `definition` "timedQuote".
 */
export interface TimedQuote {
  speaker: Speaker;
  /**
   * Alıntı; ad içermez
   */
  quote: string;
  t: Ts;
  t_end?: Ts;
}
/**
 * This interface was referenced by `Common`'s JSON-Schema
 * via the `definition` "evidenceRef".
 */
export interface EvidenceRef {
  kind: "lesson" | "quiz" | "chat" | "instructor";
  source: string;
  quote: string;
  href?: string;
  observation_id?: number;
}
/**
 * This interface was referenced by `Common`'s JSON-Schema
 * via the `definition` "providerAttempt".
 */
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
