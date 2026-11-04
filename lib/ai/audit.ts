import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { ZERO_USAGE, estUsdByModel, getAiEnv, type AiEnv, type ModelUsage, type TokenUsage } from "@/lib/config/ai.server";
import { classifyAnthropicError, getAnthropic, readJsonText, readUsage, readUsageByModel, servedByFallback, summarizeAnthropicError, toAnthropicJsonSchema } from "./anthropic";
import { SERVER_FALLBACK_BETA } from "./observeProvider";
import { AUDIT_SYSTEM, buildAuditUserText, type AuditItem } from "./prompts/audit.v1";

// Denetim geçişi sağlayıcısı (PLAN_V2 3f). Metin yalnız bu çağrı süresince bellekte; görsel gitmez; istem ve çıktı
// loglanmaz (yalnız neden ve sayılar). Başarısızlıkta denetim atlanır ve safety.ts tek başına uygulanır: rapor asla
// boş gitmez (lib/score/engine/audit.ts şablona düşürür).

export const AuditOutput = z.object({
  rewrites: z.array(z.object({ path: z.string(), text: z.string() })).max(80),
  /** Kısa denetçi notları (loglanmaz; signals.audit içinde sayı olarak kalır). */
  notes: z.array(z.string()).max(5),
});
export type AuditOutput = z.infer<typeof AuditOutput>;

export const AUDIT_JSON_SCHEMA = toAnthropicJsonSchema(AuditOutput);
export const AUDIT_MAX_TOKENS = 6_000;

export type AuditResult = { out: AuditOutput | null; usage: TokenUsage; usageByModel: ModelUsage[]; model: string; estUsd: number; fallbackServed: boolean; reason?: string };

export interface AuditProvider {
  readonly model: string;
  /** Hata fırlatmaz: başarısızlıkta out null ve reason dolu (denetim atlanır). */
  audit(args: { scores: Record<string, number>; items: readonly AuditItem[] }, signal: AbortSignal, timeoutMs: number): Promise<AuditResult>;
}

export class ClaudeAuditProvider implements AuditProvider {
  readonly model: string;
  private readonly env: AiEnv;
  private readonly client?: Anthropic;

  constructor(opts: { env?: AiEnv; client?: Anthropic } = {}) {
    this.env = opts.env ?? getAiEnv();
    this.model = this.env.claudeScoreModel;
    this.client = opts.client;
  }

  buildParams(args: { scores: Record<string, number>; items: readonly AuditItem[] }): MessageCreateParamsNonStreaming {
    const params: MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: AUDIT_MAX_TOKENS,
      system: [{ type: "text", text: AUDIT_SYSTEM, cache_control: { type: "ephemeral", ttl: this.env.cacheTtl } }],
      messages: [{ role: "user", content: buildAuditUserText(args) }],
      output_config: { effort: this.env.claudeAuditEffort, format: { type: "json_schema", schema: AUDIT_JSON_SCHEMA } },
    };
    if (this.env.claudeFallbacks === "default") {
      params.betas = [SERVER_FALLBACK_BETA];
      params.fallbacks = "default";
    }
    return params;
  }

  async audit(args: { scores: Record<string, number>; items: readonly AuditItem[] }, signal: AbortSignal, timeoutMs: number): Promise<AuditResult> {
    const empty = (reason: string): AuditResult => ({ out: null, usage: ZERO_USAGE, usageByModel: [], model: this.model, estUsd: 0, fallbackServed: false, reason });
    let res: BetaMessage;
    try {
      const anthropic = this.client ?? getAnthropic();
      res = await anthropic.beta.messages.create(this.buildParams(args), { signal, timeout: timeoutMs });
    } catch (e) {
      if (e instanceof ApiError) return empty("config");
      console.warn(`[audit] claude hata: ${summarizeAnthropicError(e)}`);
      return empty(classifyAnthropicError(e, signal));
    }
    const usageByModel = readUsageByModel(res);
    const base = { usage: readUsage(res), usageByModel, model: res.model, estUsd: estUsdByModel(usageByModel), fallbackServed: servedByFallback(res) };
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
      console.warn(`[audit] claude ${res.stop_reason}`);
      return { ...base, out: null, reason: res.stop_reason };
    }
    const text = readJsonText(res).text;
    if (!text) return { ...base, out: null, reason: "schema" };
    try {
      const parsed = AuditOutput.safeParse(JSON.parse(text));
      return parsed.success ? { ...base, out: parsed.data } : { ...base, out: null, reason: "schema" };
    } catch {
      return { ...base, out: null, reason: "schema" };
    }
  }
}

export function getAuditProvider(env: AiEnv = getAiEnv()): AuditProvider {
  return new ClaudeAuditProvider({ env });
}
