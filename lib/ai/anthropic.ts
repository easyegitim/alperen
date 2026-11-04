import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { ZERO_USAGE, addTokenUsage, type ModelUsage, type TokenUsage } from "@/lib/config/ai.server";

// Anthropic (Claude) istemcisi ve yanıt/hata yardımcıları (engine spec §2.3, §9.3, §9.4; sözleşme C3).
// Görsel, istem, oylar ve model çıktısı asla loglanmaz: özetler yalnız durum kodu, hata tipi ve istek kimliği taşır.

let client: Anthropic | null = null;

/** Tekil istemci. maxRetries 0: yeniden denemeyi motor (§2.5) ve koç (§9.6) kendi süre sınırıyla yönetir. */
export function getAnthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new ApiError("AI_FAILED", "Claude servisi yapılandırılmamış.");
    client = new Anthropic({ apiKey, maxRetries: 0 });
  }
  return client;
}

// ---------------------------------------------------------------------------------------------------------------------
// JSON şema dönüşümü

/** Yapılandırılmış çıktının desteklediği string biçimleri (structured outputs belgesi). */
const SUPPORTED_STRING_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Bir JSON şema düğümünü yapılandırılmış çıktı alt kümesine indirger. İzin listesi: type, enum, const, anyOf (oneOf →
 * anyOf), allOf, $ref, $defs, description, title, properties, required, items, desteklenen format, minItems 0/1.
 * Geri kalan her şey (minimum, maximum, minLength, maxLength, maxItems, pattern, default, $schema …) atılır;
 * sınırlar sunucudaki Zod safeParse'ta kalır. Her nesne additionalProperties:false ve required alır.
 * SDK'nın transformJSONSchema'sından farkı: enum ve const korunur (o, enum'u açıklama metnine taşır).
 */
function strictNode(node: unknown, at: string): Json {
  if (!isObj(node)) throw new Error(`toAnthropicJsonSchema: ${at} bir şema nesnesi değil`);
  const out: Json = {};
  if (isObj(node.$defs)) {
    out.$defs = Object.fromEntries(Object.entries(node.$defs).map(([k, v]) => [k, strictNode(v, `${at}.$defs.${k}`)]));
  }
  if (typeof node.$ref === "string") {
    out.$ref = node.$ref;
    return out;
  }
  const variants = Array.isArray(node.anyOf) ? node.anyOf : Array.isArray(node.oneOf) ? node.oneOf : null;
  if (variants) out.anyOf = variants.map((v, i) => strictNode(v, `${at}.anyOf[${i}]`));
  if (Array.isArray(node.allOf)) out.allOf = node.allOf.map((v, i) => strictNode(v, `${at}.allOf[${i}]`));
  if (node.type !== undefined) out.type = node.type;
  if (Array.isArray(node.enum)) out.enum = [...node.enum];
  if ("const" in node) out.const = node.const;
  if (typeof node.description === "string") out.description = node.description;
  if (typeof node.title === "string") out.title = node.title;

  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes("object") || isObj(node.properties)) {
    if (node.additionalProperties !== undefined && node.additionalProperties !== false) {
      // z.record / passthrough: additionalProperties yalnız false olabilir; yanlış şema göndermek yerine erken hata.
      throw new Error(`toAnthropicJsonSchema: ${at} serbest anahtarlı nesne desteklenmez`);
    }
    const props = isObj(node.properties) ? node.properties : {};
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, strictNode(v, `${at}.${k}`)]));
    out.additionalProperties = false;
    out.required = Array.isArray(node.required) ? [...node.required] : [];
  }
  if (types.includes("string") && typeof node.format === "string" && SUPPORTED_STRING_FORMATS.has(node.format)) {
    out.format = node.format;
  }
  if (types.includes("array")) {
    if (node.items !== undefined) out.items = strictNode(node.items, `${at}[]`);
    if (node.minItems === 0 || node.minItems === 1) out.minItems = node.minItems;
  }
  return out;
}

/** Zod şemasından Claude yapılandırılmış çıktı şeması (output_config.format.schema). enum'lar korunur. */
export function toAnthropicJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // reused: "ref" — tekrar eden alt şemalar (ör. 7 alt skorun ortak SubAssessment'ı) satır içi kopyalanmak yerine $defs'e
  // çıkarılır; aksi hâlde derlenen gramer API sınırını aşıyor (400 "compiled grammar is too large", 4 Kas canlı duman testi).
  return strictNode(z.toJSONSchema(schema, { reused: "ref" }), "$");
}

// ---------------------------------------------------------------------------------------------------------------------
// Yanıt okuma

type ContentOnly = Pick<BetaMessage, "content">;
type UsageOnly = Pick<BetaMessage, "usage">;
type UsageAndModel = Pick<BetaMessage, "usage" | "model">;

/**
 * İlk "text" bloğu. Opus 5.5 thinking parametresi gönderilmese de önce bir thinking bloğu döndürür; bu yüzden
 * content[0] asla varsayılmaz. stop_reason her zaman bundan önce okunur (refusal / max_tokens).
 */
export function readJsonText(res: ContentOnly): { text: string | null } {
  for (const block of res.content) {
    if (block.type === "text") return { text: block.text };
  }
  return { text: null };
}

type UsageFields = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_creation: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null;
};

/** cache_creation kırılımı yoksa yazım 1 sa fiyatıyla sayılır (maliyet eksik değil, fazla tahmin). */
function toTokenUsage(u: UsageFields): TokenUsage {
  const created = u.cache_creation_input_tokens ?? 0;
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite5m: u.cache_creation ? u.cache_creation.ephemeral_5m_input_tokens : 0,
    cacheWrite1h: u.cache_creation ? u.cache_creation.ephemeral_1h_input_tokens : created,
  };
}

/**
 * Model başına kullanım (fiyatlama için). Sunucu taraflı yedekte üst düzey `usage` yalnız dönen mesajı üreten denemeyi
 * kapsar; reddeden deneme (ör. Opus 5.5'in çıktı ortasında reddi) yalnız `usage.iterations` içinde `message` girdisi
 * olarak görünür ve normal fiyatla faturalanır. Bu yüzden iterations doluysa faturanın kaynağı odur: `message` ve
 * `fallback_message` girdileri kendi `model`leriyle toplanır. iterations yoksa üst düzey alanlar `res.model` ile.
 * Modeli bildirilmeyen `message` girdisi `res.model`e yazılır.
 */
export function readUsageByModel(res: UsageAndModel): ModelUsage[] {
  const iterations = (res.usage.iterations ?? []).filter((i) => i.type === "message" || i.type === "fallback_message");
  if (iterations.length === 0) return [{ model: res.model, usage: toTokenUsage(res.usage) }];
  const byModel = new Map<string, TokenUsage>();
  for (const it of iterations) {
    const model = it.model ?? res.model;
    byModel.set(model, addTokenUsage(byModel.get(model) ?? ZERO_USAGE, toTokenUsage(it)));
  }
  return [...byModel].map(([model, usage]) => ({ model, usage }));
}

/** Yanıtın toplam kullanımı (tüm denemeler; readUsageByModel'in toplamı). Fiyatlama için readUsageByModel kullanılır. */
export function readUsage(res: UsageAndModel): TokenUsage {
  return readUsageByModel(res).reduce((acc, m) => addTokenUsage(acc, m.usage), ZERO_USAGE);
}

/** Yanıtın bir kısmı sunucu taraflı yedek modelden geldiyse true (usage.iterations içinde fallback_message). */
export function servedByFallback(res: UsageOnly): boolean {
  return (res.usage.iterations ?? []).some((i) => i.type === "fallback_message");
}

// ---------------------------------------------------------------------------------------------------------------------
// Hata sınıflandırma (engine spec §9.3, en özelden genele)

export type SampleReason = "timeout" | "aborted" | "transient" | "too_large" | "fatal" | "refusal" | "max_tokens" | "schema";

/** Son tarih iptalinin nedeni: motor deadline denetleyicisini controller.abort(DEADLINE_ABORT_REASON) ile keser. */
export const DEADLINE_ABORT_REASON = "deadline";

/** Sinyal neden iptal edildi: son tarih / zaman aşımı → timeout; erken durma veya ölümcül kardeş → aborted. */
export function abortReason(signal: AbortSignal | undefined): SampleReason {
  const r: unknown = signal?.reason;
  if (r === DEADLINE_ABORT_REASON) return "timeout";
  if (typeof r === "object" && r !== null && "name" in r && r.name === "TimeoutError") return "timeout";
  return "aborted";
}

const TIMEOUT_MESSAGE = "Request timed out.";
const TRANSIENT_STATUS = new Set([408, 409, 429]);

function byStatus(status: number): SampleReason {
  if (status === 413) return "too_large";
  if (TRANSIENT_STATUS.has(status) || status >= 500) return "transient";
  return "fatal";
}

/** Bir hatanın "status" alanı (SDK dışı veya başka kopyadan gelen hata için ördek tiplemesi). */
function duckStatus(e: unknown): number | undefined {
  if (typeof e !== "object" || e === null || !("status" in e)) return undefined;
  return typeof e.status === "number" ? e.status : undefined;
}

/**
 * Fırlatılan bir hatayı örnek nedenine çevirir. Sıra §9.3 tablosudur. instanceof SDK sınıflarıyla yapılır; yalnız
 * SDK'nın başka bir kopyasından (CJS/ESM) gelen hata için ileti/durum koduyla ördek tiplemesi uygulanır.
 * HTTP 200 yanıtları (refusal, max_tokens, şema) burada değil, sağlayıcıda stop_reason'dan sınıflanır.
 */
export function classifyAnthropicError(e: unknown, signal?: AbortSignal): SampleReason {
  if (signal?.aborted) return abortReason(signal);
  if (e instanceof Anthropic.APIUserAbortError) return "aborted";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (e instanceof Anthropic.APIConnectionError) return "transient";
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.ConflictError) return "transient";
  if (e instanceof Anthropic.APIError) return typeof e.status === "number" ? byStatus(e.status) : "transient";
  // SDK dışı veya başka modül kopyası.
  if (e instanceof Error && e.message === TIMEOUT_MESSAGE) return "timeout";
  if (e instanceof Error && e.name === "AbortError") return "aborted";
  const status = duckStatus(e);
  if (status !== undefined && status >= 400) return byStatus(status);
  return "schema";
}

/** Loga uygun özet (≤ 100 karakter): durum, hata tipi, istek kimliği. İleti gövdesi, istem veya görsel yok. */
export function summarizeAnthropicError(e: unknown): string {
  const reason = classifyAnthropicError(e);
  const s =
    e instanceof Anthropic.APIError
      ? `${reason} ${e.status ?? "-"} ${e.type ?? "-"} ${e.requestID ?? "-"}`
      : `${reason} ${duckStatus(e) ?? "-"} ${e instanceof Error ? e.name : typeof e}`;
  return s.slice(0, 100);
}
