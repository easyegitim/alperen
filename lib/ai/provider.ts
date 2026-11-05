import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam, BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { GoogleGenAI } from "@google/genai";
import { ApiError } from "@/lib/api/errors";
import { ZERO_USAGE, estUsdByModel, getAiEnv, type AiEnv, type ModelUsage, type TokenUsage } from "@/lib/config/ai.server";
import { COACH } from "@/lib/config/engine.server";
import { SCORE_CALL_TIMEOUT_MS, SCORE_RETRIES, SCORE_RETRY_BASE_MS, getScoringEnv } from "@/lib/config/scoring";
import { classifyAnthropicError, getAnthropic, readJsonText, readUsage, readUsageByModel, servedByFallback, summarizeAnthropicError, toAnthropicJsonSchema } from "./anthropic";
import type { ViewKey } from "@/lib/face/views";
import { SERVER_FALLBACK_BETA, SampleError } from "./observeProvider";
import { SCORE_V2_SYSTEM } from "./prompts/score.v2";
import { ScoreOutputV2, normalizeScoreOutputV2 } from "./scoreSchema.v2";
import { aiErrorSummary, isTransientAiError, withTransientRetry } from "./retry";
import { COACH_REPORT_JSON_SCHEMA, CoachReport } from "./reportSchema";
import { PlanSelectionOutput, normalizePlanSelection } from "./reportSchema.v3";
import { PLAN_V3_SYSTEM } from "./prompts/report.v3";
import { SCORE_OUTPUT_JSON_SCHEMA, ScoreOutput } from "./scoreSchema";

// SPEC 14.3 / D18: Gemini varsayılan; arayüz üzerinden fal.ai/OpenAI takılabilir.
// Görsel yalnız bu çağrı süresince bellekte tutulur; loglanmaz, yazılmaz.

export interface ScoringProvider {
  scoreOnce(imageBase64: string, prompt: string, signal?: AbortSignal): Promise<ScoreOutput>;
  readonly model: string;
  /** Son başarılı çağrının modeli (yedek model kullanıldıysa farklıdır); analyses.scoring_model buradan yazılır. */
  readonly lastModel?: string;
}

let client: GoogleGenAI | null = null;
function gemini(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new ApiError("AI_FAILED", "Skorlama servisi yapılandırılmamış.");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export class GeminiScoringProvider implements ScoringProvider {
  readonly model = getScoringEnv().scoreModel;
  readonly fallbackModel = getScoringEnv().fallbackModel;
  lastModel: string | undefined;

  private async callModel(model: string, imageBase64: string, prompt: string, signal?: AbortSignal): Promise<string | undefined> {
    const res = await gemini().models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: imageBase64 } }, { text: prompt }] }],
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        responseJsonSchema: SCORE_OUTPUT_JSON_SCHEMA,
        abortSignal: signal,
        httpOptions: { timeout: SCORE_CALL_TIMEOUT_MS },
      },
    });
    return res.text;
  }

  /**
   * Geçici hatada (503 yoğunluk / 429) üstel beklemeyle tekrar; birincil model hâlâ yanıt vermiyorsa yedek modelle bir
   * deneme daha (GEMINI_SCORE_FALLBACK_MODEL). Log yalnız durum kodu ve kısa mesaj içerir; görsel/istem/yanıt loglanmaz.
   */
  async scoreOnce(imageBase64: string, prompt: string, signal?: AbortSignal): Promise<ScoreOutput> {
    let text: string | undefined;
    try {
      try {
        text = await withTransientRetry(() => this.callModel(this.model, imageBase64, prompt, signal), {
          retries: SCORE_RETRIES,
          baseDelayMs: SCORE_RETRY_BASE_MS,
          signal,
          onRetry: (attempt, e) => console.warn(`[ai] skor ${this.model} geçici hata, tekrar ${attempt}: ${aiErrorSummary(e)}`),
        });
        this.lastModel = this.model;
      } catch (e) {
        if (!this.fallbackModel || this.fallbackModel === this.model || !isTransientAiError(e) || signal?.aborted) throw e;
        console.warn(`[ai] skor ${this.model} yanıt vermedi (${aiErrorSummary(e)}); yedek model: ${this.fallbackModel}`);
        text = await this.callModel(this.fallbackModel, imageBase64, prompt, signal);
        this.lastModel = this.fallbackModel;
      }
    } catch (e) {
      if (signal?.aborted || (e instanceof Error && /abort|timeout/i.test(e.message))) {
        console.warn(`[ai] skor zaman aşımı: ${aiErrorSummary(e)}`);
        throw new ApiError("AI_TIMEOUT", "Skorlama zaman aşımına uğradı.");
      }
      console.warn(`[ai] skor hata: ${aiErrorSummary(e)}`);
      throw new ApiError("AI_FAILED", "Skorlama servisi yanıt vermedi.");
    }
    try {
      return ScoreOutput.parse(JSON.parse(text ?? ""));
    } catch {
      throw new ApiError("AI_FAILED", "Skorlama yanıtı şemaya uymadı.");
    }
  }
}

export function getScoringProvider(): ScoringProvider {
  return new GeminiScoringProvider();
}

/**
 * Bir rapor denemesinin sonucu. report: JSON.parse(raw) ya da null (refusal, max_tokens, bozuk JSON); doğrulama
 * çağıranda (CoachReport.safeParse). raw her durumda saklanır (log ve kırmızı takım incelemesi için; kullanıcıya gitmez).
 */
export type ReportGeneration = {
  report: unknown;
  raw: string;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Tahmini maliyet (USD); fiyatı bilinmeyen sağlayıcıda (Gemini) yok, ops görünümü sabit tahmine düşer. */
  estUsd?: number;
  /** Yanıtı üreten model (sunucu taraflı yedek kullanıldıysa farklıdır). */
  servedModel?: string;
  /** Yanıtın bir kısmı sunucu taraflı yedek modelden geldiyse true (Claude). */
  fallbackServed?: boolean;
};

/** Deneme başına kullanım bildirimi (engine spec §9.6, sözleşme C10). Başarısız denemelerde de bir kez çağrılır. */
export type ReportUsageCallback = (u: TokenUsage, info: { model: string; estUsd: number | null }) => void;

export type ReportCallOptions = { timeoutMs?: number; onUsage?: ReportUsageCallback };

export interface ReportProvider {
  readonly model: string;
  /** Ham çıktıyı döndürür; doğrulama çağıranda. onUsage deneme başına bir kez (hata dahil) çağrılır. */
  generateReport(systemPrompt: string, userMessage: string, signal?: AbortSignal, opts?: ReportCallOptions): Promise<ReportGeneration>;
}

/** Koç raporu sınırları (engine spec §2.5 COACH): tek kaynak lib/config/engine.server.ts. Rota maxDuration 120 s içinde kalır. */
export { COACH };

const GEMINI_REPORT_TIMEOUT_MS = 45_000;

export class GeminiReportProvider implements ReportProvider {
  readonly model = process.env.GEMINI_COACH_MODEL || "gemini-3.5-flash-lite";

  async generateReport(systemPrompt: string, userMessage: string, signal?: AbortSignal, opts: ReportCallOptions = {}): Promise<ReportGeneration> {
    const timeout = Math.min(GEMINI_REPORT_TIMEOUT_MS, opts.timeoutMs ?? GEMINI_REPORT_TIMEOUT_MS);
    try {
      const res = await withTransientRetry(
        () =>
          gemini().models.generateContent({
            model: this.model,
            contents: [{ role: "user", parts: [{ text: userMessage }] }],
            config: {
              systemInstruction: systemPrompt,
              temperature: 0.4,
              responseMimeType: "application/json",
              responseJsonSchema: COACH_REPORT_JSON_SCHEMA,
              abortSignal: signal,
              httpOptions: { timeout },
            },
          }),
        { retries: 1, baseDelayMs: SCORE_RETRY_BASE_MS, signal, onRetry: (attempt, e) => console.warn(`[ai] rapor ${this.model} geçici hata, tekrar ${attempt}: ${aiErrorSummary(e)}`) },
      );
      const m = res.usageMetadata;
      const cached = m?.cachedContentTokenCount ?? 0;
      // Gemini fiyatı AI_PRICING'de yok: estUsd null, ops.daily_ai_cost rapor başına sabit tahmine düşer.
      opts.onUsage?.(
        { input: Math.max(0, (m?.promptTokenCount ?? 0) - cached), output: (m?.candidatesTokenCount ?? 0) + (m?.thoughtsTokenCount ?? 0), cacheRead: cached, cacheWrite5m: 0, cacheWrite1h: 0 },
        { model: this.model, estUsd: null },
      );
      const raw = res.text ?? "";
      let report: unknown = null;
      try {
        report = JSON.parse(raw);
      } catch {
        report = null;
      }
      return { report, raw, inputTokens: m?.promptTokenCount ?? null, outputTokens: m?.candidatesTokenCount ?? null };
    } catch (e) {
      opts.onUsage?.(ZERO_USAGE, { model: this.model, estUsd: null });
      if (signal?.aborted || (e instanceof Error && /abort|timeout/i.test(e.message))) throw new ApiError("AI_TIMEOUT", "Rapor üretimi zaman aşımına uğradı.");
      console.warn(`[ai] rapor hata: ${aiErrorSummary(e)}`);
      throw new ApiError("AI_FAILED", "Rapor servisi yanıt vermedi.");
    }
  }
}

/** Claude'a giden rapor şeması: sınırlar atılır (API desteklemez), enum ve required korunur; sınırlar sunucuda kalır. */
export const COACH_JSON_SCHEMA = toAnthropicJsonSchema(CoachReport);

/**
 * Koç raporu Claude ile (engine spec §9.6). SDK ayrıştırma yardımcıları kullanılmaz: stop_reason her zaman görünür,
 * JSON.parse ve CoachReport.safeParse bizim kodumuzda. temperature/top_p/top_k, thinking, tool_choice ve asistan ön
 * doldurması gönderilmez (Opus 5.5). İstem, not ve model çıktısı loglanmaz; log yalnız neden, durum ve istek kimliği.
 */
export class ClaudeReportProvider implements ReportProvider {
  readonly model: string;
  private readonly env: AiEnv;
  private readonly client?: Anthropic;
  private readonly maxTokens: number;

  /** client yalnız testte verilir (gerçek SDK + sahte fetch); üretimde getAnthropic() tekili kullanılır. */
  constructor(opts: { env?: AiEnv; client?: Anthropic; maxTokens?: number } = {}) {
    this.env = opts.env ?? getAiEnv();
    this.model = this.env.claudeCoachModel;
    this.client = opts.client;
    this.maxTokens = opts.maxTokens ?? COACH.maxTokens;
  }

  buildParams(systemPrompt: string, userMessage: string): MessageCreateParamsNonStreaming {
    const params: MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral", ttl: this.env.cacheTtl } }],
      messages: [{ role: "user", content: userMessage }],
      output_config: { effort: this.env.claudeCoachEffort, format: { type: "json_schema", schema: COACH_JSON_SCHEMA } },
    };
    if (this.env.claudeFallbacks === "default") {
      params.betas = [SERVER_FALLBACK_BETA];
      params.fallbacks = "default";
    }
    return params;
  }

  async generateReport(systemPrompt: string, userMessage: string, signal?: AbortSignal, opts: ReportCallOptions = {}): Promise<ReportGeneration> {
    const timeout = Math.max(1, Math.min(COACH.attemptTimeoutMs, opts.timeoutMs ?? COACH.attemptTimeoutMs));
    let res: BetaMessage;
    try {
      const anthropic = this.client ?? getAnthropic();
      res = await anthropic.beta.messages.create(this.buildParams(systemPrompt, userMessage), { signal, timeout });
    } catch (e) {
      // Hata yanıtı kullanım taşımaz: deneme sıfır tokenla sayılır.
      opts.onUsage?.(ZERO_USAGE, { model: this.model, estUsd: 0 });
      if (e instanceof ApiError) throw e; // ANTHROPIC_API_KEY yok (yapılandırma)
      const reason = classifyAnthropicError(e, signal);
      console.warn(`[ai] rapor claude hata: ${summarizeAnthropicError(e)}`);
      if (reason === "timeout" || reason === "aborted") throw new ApiError("AI_TIMEOUT", "Rapor üretimi zaman aşımına uğradı.");
      throw new ApiError("AI_FAILED", "Rapor servisi yanıt vermedi.");
    }
    const usage = readUsage(res);
    // Yedek zincirinde reddeden denemeler de faturalanır: her halka kendi modelinin fiyatıyla (usage.iterations).
    const cost = estUsdByModel(readUsageByModel(res));
    opts.onUsage?.(usage, { model: res.model, estUsd: cost });
    const raw = readJsonText(res).text ?? "";
    let report: unknown = null;
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
      console.warn(`[ai] rapor claude ${res.stop_reason}${res.stop_reason === "refusal" ? ` ${res.stop_details?.category ?? "-"}` : ""}`);
    } else {
      try {
        report = JSON.parse(raw);
      } catch {
        report = null;
      }
    }
    return {
      report,
      raw,
      inputTokens: usage.input + usage.cacheRead + usage.cacheWrite5m + usage.cacheWrite1h,
      outputTokens: usage.output,
      estUsd: cost,
      servedModel: res.model,
      fallbackServed: servedByFallback(res),
    };
  }
}

// ─── Plan seçimi v3 (PLAN 4e; CONTRACTS_V2 S2.1 kural 1): Claude bilgi tabanından kimlik seçer, plan kodda kurulur ──────
// Küçük/düz şema (lib/ai/reportSchema.v3.ts); aynı SDK kalıbı (beta.messages.create, output_config json_schema, efor,
// sunucu taraflı yedek). temperature/top_p/top_k, thinking, tool_choice ve ön doldurma yok (Opus 5.5). İstem ve çıktı
// loglanmaz; fotoğraf hiç gitmez.

/** Claude'a giden plan seçimi şeması (enum + required korunur; sınırlar normalizePlanSelection'da). */
export const PLAN_SELECTION_JSON_SCHEMA = toAnthropicJsonSchema(PlanSelectionOutput);

/** ~16 seçim × (kimlik + faz + bölge + bir cümle) ≈ 2–3k token + düşük efor düşünmesi. */
export const PLAN_SELECTION_MAX_TOKENS = 8_000;

export type PlanSelectionResult = {
  /** Şemadan geçmiş, tekilleştirilmiş seçim; refusal/max_tokens/bozuk JSON'da null (çağıran belirlenimci yedeğe düşer). */
  out: PlanSelectionOutput | null;
  reason?: string;
  usage: TokenUsage;
  model: string;
  estUsd: number;
  fallbackServed: boolean;
};

export interface PlanSelectionProvider {
  readonly model: string;
  /** Hata fırlatmaz (yapılandırma hariç): başarısızlıkta out null ve reason dolu. */
  selectPlan(userMessage: string, signal: AbortSignal, timeoutMs: number): Promise<PlanSelectionResult>;
}

export class ClaudePlanSelectionProvider implements PlanSelectionProvider {
  readonly model: string;
  private readonly env: AiEnv;
  private readonly client?: Anthropic;

  /** client yalnız testte verilir (gerçek SDK + sahte fetch); üretimde getAnthropic() tekili. */
  constructor(opts: { env?: AiEnv; client?: Anthropic } = {}) {
    this.env = opts.env ?? getAiEnv();
    this.model = this.env.claudeCoachModel;
    this.client = opts.client;
  }

  buildParams(userMessage: string): MessageCreateParamsNonStreaming {
    const params: MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: PLAN_SELECTION_MAX_TOKENS,
      system: [{ type: "text", text: PLAN_V3_SYSTEM, cache_control: { type: "ephemeral", ttl: this.env.cacheTtl } }],
      messages: [{ role: "user", content: userMessage }],
      output_config: { effort: this.env.claudeCoachEffort, format: { type: "json_schema", schema: PLAN_SELECTION_JSON_SCHEMA } },
    };
    if (this.env.claudeFallbacks === "default") {
      params.betas = [SERVER_FALLBACK_BETA];
      params.fallbacks = "default";
    }
    return params;
  }

  async selectPlan(userMessage: string, signal: AbortSignal, timeoutMs: number): Promise<PlanSelectionResult> {
    const empty = (reason: string): PlanSelectionResult => ({ out: null, reason, usage: ZERO_USAGE, model: this.model, estUsd: 0, fallbackServed: false });
    let res: BetaMessage;
    try {
      const anthropic = this.client ?? getAnthropic();
      res = await anthropic.beta.messages.create(this.buildParams(userMessage), { signal, timeout: Math.max(1, timeoutMs) });
    } catch (e) {
      if (e instanceof ApiError) throw e; // ANTHROPIC_API_KEY yok (yapılandırma; sahte başarı yok)
      console.warn(`[ai] plan claude hata: ${summarizeAnthropicError(e)}`);
      return empty(classifyAnthropicError(e, signal));
    }
    const usageByModel = readUsageByModel(res);
    const base = { usage: readUsage(res), model: res.model, estUsd: estUsdByModel(usageByModel), fallbackServed: servedByFallback(res) };
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
      console.warn(`[ai] plan claude ${res.stop_reason}${res.stop_reason === "refusal" ? ` ${res.stop_details?.category ?? "-"}` : ""}`);
      return { ...base, out: null, reason: res.stop_reason };
    }
    const text = readJsonText(res).text;
    if (!text) return { ...base, out: null, reason: "schema" };
    try {
      const parsed = PlanSelectionOutput.safeParse(JSON.parse(text));
      return parsed.success ? { ...base, out: normalizePlanSelection(parsed.data) } : { ...base, out: null, reason: "schema" };
    } catch {
      return { ...base, out: null, reason: "schema" };
    }
  }
}

export function getPlanSelectionProvider(env: AiEnv = getAiEnv()): PlanSelectionProvider {
  return new ClaudePlanSelectionProvider({ env });
}

/** AI_COACH_PROVIDER: claude | gemini (kod varsayılanı gemini). Tek değiştirme noktası. */
export function getReportProvider(env: AiEnv = getAiEnv()): ReportProvider {
  return env.coachProvider === "claude" ? new ClaudeReportProvider({ env }) : new GeminiReportProvider();
}

export type { CoachReport };

// ---------------------------------------------------------------------------------------------------------------------
// hybrid.v2: Claude puan cetveli (PLAN_V2 3c; CONTRACTS_V2 §4). Tüm açılar tek kullanıcı mesajında, etiketli; sistem
// istemi önbellekli; efor varsayılan medium; yanıt JSON şemasıyla. Tek çağrı = tek çalıştırma; ortanca ve yeniden
// deneme lib/score/engine/consensus.ts'te. Görsel yalnız bu çağrı süresince bellekte; istem/görsel/çıktı loglanmaz.

/** Görünüm etiketli base64 JPEG (data: öneki olmadan). */
export type LabeledImage = { view: ViewKey; data: string };

export type ScoreSampleV2 = { out: ScoreOutputV2; model: string; fallbackServed: boolean; usage: TokenUsage; usageByModel?: ModelUsage[] };

export interface ScoringProviderV2 {
  readonly model: string;
  /** Bir cetvel çalıştırması. Hata her zaman SampleError olarak fırlatılır (neden: timeout/transient/refusal/max_tokens/schema/fatal). */
  scoreOnce(images: readonly LabeledImage[], userText: string, signal: AbortSignal, timeoutMs: number): Promise<ScoreSampleV2>;
}

/**
 * Düşünme + ~3–4k tokenlık Türkçe JSON (7 alt skor × 5 satır + 9 bölge). Opus 5.5'te düşünme kapatılamaz ve aynı bütçeyi
 * paylaşır; medium eforda altı görselle 10k aşılabiliyordu (stop_reason max_tokens → ücretli çalıştırma boşa). 16k:
 * çağrıya açık timeout verildiğinden SDK'nın akışsız sınırı devreye girmez. Aşılırsa output_tokens loglanır (ayar için).
 */
export const SCORE_V2_MAX_TOKENS = 16_000;

/** Claude'a giden cetvel şeması: enum ve required korunur; sayısal/dizi sınırları sunucuda normalizeScoreOutputV2 ile kenetlenir. */
export const SCORE_V2_JSON_SCHEMA = toAnthropicJsonSchema(ScoreOutputV2);

const VIEW_LABEL_EN: Record<ViewKey, string> = {
  front: "front view",
  profile_left: "left side profile",
  profile_right: "right side profile",
  left45: "left 45-degree half profile",
  right45: "right 45-degree half profile",
  hairline: "hairline (forehead) view",
};

function parseScoreV2(text: string | null, meta: { usage: TokenUsage; usageByModel?: ModelUsage[]; model: string }): ScoreOutputV2 {
  if (!text) throw new SampleError("schema", { ...meta, detail: "no text" });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SampleError("schema", { ...meta, detail: "json" });
  }
  const r = ScoreOutputV2.safeParse(json);
  if (!r.success) throw new SampleError("schema", { ...meta, detail: "safeParse" });
  return normalizeScoreOutputV2(r.data);
}

export class ClaudeScoringProvider implements ScoringProviderV2 {
  readonly model: string;
  private readonly env: AiEnv;
  private readonly client?: Anthropic;
  private readonly maxTokens: number;

  /** client yalnız testte verilir (gerçek SDK + sahte fetch); üretimde getAnthropic() tekili kullanılır. */
  constructor(opts: { env?: AiEnv; client?: Anthropic; maxTokens?: number } = {}) {
    this.env = opts.env ?? getAiEnv();
    this.model = this.env.claudeScoreModel;
    this.client = opts.client;
    this.maxTokens = opts.maxTokens ?? SCORE_V2_MAX_TOKENS;
  }

  /** İstek gövdesi: her görselin önünde İngilizce etiket, sonda bağlam metni. temperature/top_p/top_k, thinking, tool_choice, prefill yok. */
  buildParams(images: readonly LabeledImage[], userText: string): MessageCreateParamsNonStreaming {
    const content: BetaContentBlockParam[] = [];
    images.forEach((img, i) => {
      content.push({ type: "text", text: `Photo ${i + 1}: ${VIEW_LABEL_EN[img.view]}` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.data } });
    });
    content.push({ type: "text", text: userText });
    const params: MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: [{ type: "text", text: SCORE_V2_SYSTEM, cache_control: { type: "ephemeral", ttl: this.env.cacheTtl } }],
      messages: [{ role: "user", content }],
      output_config: { effort: this.env.claudeScoreEffort, format: { type: "json_schema", schema: SCORE_V2_JSON_SCHEMA } },
    };
    if (this.env.claudeFallbacks === "default") {
      params.betas = [SERVER_FALLBACK_BETA];
      params.fallbacks = "default";
    }
    return params;
  }

  async scoreOnce(images: readonly LabeledImage[], userText: string, signal: AbortSignal, timeoutMs: number): Promise<ScoreSampleV2> {
    let anthropic: Anthropic;
    try {
      anthropic = this.client ?? getAnthropic();
    } catch (e) {
      throw new SampleError("fatal", { detail: e instanceof ApiError ? e.message : "client" });
    }
    let res: BetaMessage;
    try {
      res = await anthropic.beta.messages.create(this.buildParams(images, userText), { signal, timeout: timeoutMs });
    } catch (e) {
      const reason = classifyAnthropicError(e, signal);
      const status = typeof e === "object" && e !== null && "status" in e && typeof e.status === "number" ? e.status : undefined;
      throw new SampleError(reason, { status, detail: summarizeAnthropicError(e) });
    }
    const meta = { usage: readUsage(res), usageByModel: readUsageByModel(res), model: res.model };
    if (res.stop_reason === "refusal") throw new SampleError("refusal", { ...meta, category: res.stop_details?.category ?? null });
    if (res.stop_reason === "max_tokens") {
      console.warn(`[ai] score claude max_tokens output=${meta.usage.output} limit=${this.maxTokens}`);
      throw new SampleError("max_tokens", meta);
    }
    const out = parseScoreV2(readJsonText(res).text, meta);
    return { out, model: res.model, fallbackServed: servedByFallback(res), usage: meta.usage, usageByModel: meta.usageByModel };
  }
}

export function getScoringProviderV2(env: AiEnv = getAiEnv()): ScoringProviderV2 {
  return new ClaudeScoringProvider({ env });
}
