import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { OBSERVE_MAX_TOKENS, getAiEnv, type AiEnv, type ModelUsage, type TokenUsage } from "@/lib/config/ai.server";
import {
  abortReason,
  classifyAnthropicError,
  getAnthropic,
  readJsonText,
  readUsage,
  readUsageByModel,
  servedByFallback,
  summarizeAnthropicError,
  toAnthropicJsonSchema,
  type SampleReason,
} from "./anthropic";
import { ObservationOutput, type Observation } from "./observationSchema";
import { OBSERVE_SYSTEM, OBSERVE_USER_TEXT } from "./prompts/observe.v2";
import { aiErrorSummary, isTransientAiError } from "./retry";

// Gözlem sağlayıcıları (engine spec §2.3, §9.5; sözleşme C3). Tek çağrı = tek örnek; yeniden deneme, yeter sayı, erken
// durma ve son tarih motorda (§2.5). Görsel yalnız bu çağrı süresince bellekte; istem, görsel ve oylar loglanmaz.
// Claude'a hiçbir zaman sayı/skor sorulmaz: şema yalnız enum ve boolean içerir.

export type { SampleReason, TokenUsage };

/**
 * usage: tüm denemelerin toplamı. usageByModel: model başına kırılım (sunucu taraflı yedekte reddeden deneme dahil);
 * verilirse motor her halkayı kendi modelinin fiyatıyla sayar, verilmezse usage `model` fiyatıyla sayılır.
 */
export type ObservationSample = { obs: Observation; model: string; fallbackServed: boolean; usage: TokenUsage; usageByModel?: ModelUsage[] };

/**
 * Başarısız örnek. HTTP 200 dönen ama kontrolden geçmeyen yanıtlarda (refusal, max_tokens, schema) faturalanan
 * kullanım `usage` ile taşınır; motor bunu ai_usage'a ekler.
 */
export class SampleError extends Error {
  readonly reason: SampleReason;
  readonly status?: number;
  readonly category?: string | null;
  readonly usage?: TokenUsage;
  readonly usageByModel?: ModelUsage[];
  readonly model?: string;
  constructor(
    reason: SampleReason,
    opts: { status?: number; category?: string | null; usage?: TokenUsage; usageByModel?: ModelUsage[]; model?: string; detail?: string } = {},
  ) {
    super(opts.detail ? `observe ${reason}: ${opts.detail}` : `observe ${reason}`);
    this.name = "SampleError";
    this.reason = reason;
    this.status = opts.status;
    this.category = opts.category;
    this.usage = opts.usage;
    this.usageByModel = opts.usageByModel;
    this.model = opts.model;
  }
}

export interface ObservationProvider {
  readonly name: "claude" | "gemini";
  readonly model: string;
  /** Bir gözlem örneği. Hata her zaman SampleError olarak fırlatılır. */
  observeOnce(imageBase64: string, signal: AbortSignal, timeoutMs: number): Promise<ObservationSample>;
}

function parseObservation(text: string | null | undefined, meta: { usage: TokenUsage; usageByModel?: ModelUsage[]; model: string }): Observation {
  if (!text) throw new SampleError("schema", { ...meta, detail: "no text" });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SampleError("schema", { ...meta, detail: "json" });
  }
  const r = ObservationOutput.safeParse(json);
  if (!r.success) throw new SampleError("schema", { ...meta, detail: "safeParse" });
  return r.data;
}

// ---------------------------------------------------------------------------------------------------------------------
// Claude

/** Modül yüklenirken bir kez üretilir: her string yaprak enum'unu korur, her nesne additionalProperties:false + required. */
export const OBSERVATION_JSON_SCHEMA = toAnthropicJsonSchema(ObservationOutput);

/** Sunucu taraflı yedek (refusal kategorisine göre yönlendirme); CLAUDE_FALLBACKS=off iken gönderilmez. */
export const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class ClaudeObservationProvider implements ObservationProvider {
  readonly name = "claude" as const;
  readonly model: string;
  private readonly env: AiEnv;
  private readonly client?: Anthropic;
  private readonly maxTokens: number;

  /** client yalnız testte verilir (gerçek SDK + sahte fetch); üretimde getAnthropic() tekili kullanılır. */
  constructor(opts: { env?: AiEnv; client?: Anthropic; maxTokens?: number } = {}) {
    this.env = opts.env ?? getAiEnv();
    this.model = this.env.claudeObserveModel;
    this.client = opts.client;
    this.maxTokens = opts.maxTokens ?? OBSERVE_MAX_TOKENS;
  }

  /** İstek gövdesi. temperature/top_p/top_k, thinking, tool_choice ve asistan ön doldurması yoktur (Opus 5.5). */
  buildParams(imageBase64: string): MessageCreateParamsNonStreaming {
    const params: MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: [{ type: "text", text: OBSERVE_SYSTEM, cache_control: { type: "ephemeral", ttl: this.env.cacheTtl } }],
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
            { type: "text", text: OBSERVE_USER_TEXT },
          ],
        },
      ],
      output_config: {
        effort: this.env.claudeObserveEffort,
        format: { type: "json_schema", schema: OBSERVATION_JSON_SCHEMA },
      },
    };
    if (this.env.claudeFallbacks === "default") {
      params.betas = [SERVER_FALLBACK_BETA];
      params.fallbacks = "default";
    }
    return params;
  }

  async observeOnce(imageBase64: string, signal: AbortSignal, timeoutMs: number): Promise<ObservationSample> {
    let anthropic: Anthropic;
    try {
      anthropic = this.client ?? getAnthropic();
    } catch (e) {
      // ANTHROPIC_API_KEY yok: yapılandırma hatası, kardeşler de iptal edilir.
      throw new SampleError("fatal", { detail: e instanceof ApiError ? e.message : "client" });
    }
    let res: BetaMessage;
    try {
      res = await anthropic.beta.messages.create(this.buildParams(imageBase64), { signal, timeout: timeoutMs });
    } catch (e) {
      const reason = classifyAnthropicError(e, signal);
      const status = typeof e === "object" && e !== null && "status" in e && typeof e.status === "number" ? e.status : undefined;
      throw new SampleError(reason, { status, detail: summarizeAnthropicError(e) });
    }
    const meta = { usage: readUsage(res), usageByModel: readUsageByModel(res), model: res.model };
    // stop_reason her zaman metin okunmadan önce: refusal'da kısmi metin olsa bile örnek başarısızdır.
    if (res.stop_reason === "refusal") throw new SampleError("refusal", { ...meta, category: res.stop_details?.category ?? null });
    if (res.stop_reason === "max_tokens") throw new SampleError("max_tokens", meta);
    const obs = parseObservation(readJsonText(res).text, meta);
    return { obs, model: res.model, fallbackServed: servedByFallback(res), usage: meta.usage, usageByModel: meta.usageByModel };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Gemini (karşılaştırma gözlemcisi, §9.5): aynı istem, aynı şema, aynı doğrulama; çapraz sağlayıcı yedeği yok.

/** Sağlayıcının güvenlik nedeniyle kestiği yanıtlar (Claude'daki refusal karşılığı). */
const GEMINI_BLOCKED = new Set(["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "RECITATION"]);

type GeminiClient = { models: Pick<GoogleGenAI["models"], "generateContent"> };

export const OBSERVATION_GEMINI_SCHEMA = z.toJSONSchema(ObservationOutput);

function classifyGeminiError(e: unknown, signal: AbortSignal): SampleReason {
  if (signal.aborted) return abortReason(signal);
  const status = typeof e === "object" && e !== null && "status" in e && typeof e.status === "number" ? e.status : undefined;
  if (status === 413) return "too_large";
  if (status !== undefined && (status === 408 || status === 409 || status === 429 || status >= 500)) return "transient";
  if (status !== undefined && status >= 400) return "fatal";
  if (isTransientAiError(e)) return "transient";
  if (e instanceof Error && /abort|timed? ?out/i.test(`${e.name} ${e.message}`)) return "timeout";
  return "schema";
}

function geminiUsage(res: GenerateContentResponse): TokenUsage {
  const m = res.usageMetadata;
  const cached = m?.cachedContentTokenCount ?? 0;
  return {
    input: Math.max(0, (m?.promptTokenCount ?? 0) - cached),
    output: (m?.candidatesTokenCount ?? 0) + (m?.thoughtsTokenCount ?? 0),
    cacheRead: cached,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
  };
}

export class GeminiObservationProvider implements ObservationProvider {
  readonly name = "gemini" as const;
  readonly model: string;
  private client?: GeminiClient;

  constructor(opts: { env?: AiEnv; client?: GeminiClient } = {}) {
    this.model = (opts.env ?? getAiEnv()).geminiObserveModel;
    this.client = opts.client;
  }

  private gemini(): GeminiClient {
    if (!this.client) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new SampleError("fatal", { detail: "GEMINI_API_KEY" });
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  async observeOnce(imageBase64: string, signal: AbortSignal, timeoutMs: number): Promise<ObservationSample> {
    const gemini = this.gemini();
    let res: GenerateContentResponse;
    try {
      res = await gemini.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: imageBase64 } }, { text: OBSERVE_USER_TEXT }] }],
        config: {
          systemInstruction: OBSERVE_SYSTEM,
          temperature: 0,
          responseMimeType: "application/json",
          responseJsonSchema: OBSERVATION_GEMINI_SCHEMA,
          abortSignal: signal,
          httpOptions: { timeout: timeoutMs },
        },
      });
    } catch (e) {
      const reason = classifyGeminiError(e, signal);
      const status = typeof e === "object" && e !== null && "status" in e && typeof e.status === "number" ? e.status : undefined;
      throw new SampleError(reason, { status, detail: aiErrorSummary(e).slice(0, 100) });
    }
    const meta = { usage: geminiUsage(res), model: res.modelVersion ?? this.model };
    const block = res.promptFeedback?.blockReason;
    const finish = res.candidates?.[0]?.finishReason;
    if (block || (finish && GEMINI_BLOCKED.has(finish))) throw new SampleError("refusal", { ...meta, category: block ?? finish ?? null });
    if (finish === "MAX_TOKENS") throw new SampleError("max_tokens", meta);
    const obs = parseObservation(res.text, meta);
    return { obs, model: meta.model, fallbackServed: false, usage: meta.usage };
  }
}

/** AI_OBSERVE_PROVIDER'a göre sağlayıcı. Karıştırma yok: bir analizin bütün örnekleri aynı sağlayıcıdan gelir. */
export function getObservationProvider(env: AiEnv = getAiEnv()): ObservationProvider {
  return env.observeProvider === "gemini" ? new GeminiObservationProvider({ env }) : new ClaudeObservationProvider({ env });
}
