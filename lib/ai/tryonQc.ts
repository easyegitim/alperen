import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { BetaImageBlockParam, BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { ZERO_USAGE, estUsdByModel, getAiEnv, type AiEnv, type ModelUsage, type TokenUsage } from "@/lib/config/ai.server";
import { getTryonConfig, type TryonConfig } from "@/lib/config/tryon";
import { QC_REASONS, qcPass, type QcVerdict, type TryonMode } from "@/lib/tryon/types";
import { classifyAnthropicError, getAnthropic, readJsonText, readUsage, readUsageByModel, servedByFallback, summarizeAnthropicError, toAnthropicJsonSchema } from "./anthropic";
import { SERVER_FALLBACK_BETA } from "./observeProvider";

// Sanal deneme kalite kontrolü (KB §7.3 R2-C10/3 KARAR "claude'a sorulsun"; PLAN 5c; CONTRACTS_V2 S2.6).
// Claude'a sonuç + orijinal verilir: stil uygulanmış mı, stil dışı sakal temiz mi, kimlik korunmuş mu, bozukluk var mı?
// Şema KÜÇÜK ve DÜZ (hepsi zorunlu, enum, min/max yok); pass KODDA (qcPass). Görseller yalnız çağrı süresince bellekte;
// istem, görsel ve model çıktısı loglanmaz (yalnız neden kodu, durum, istek kimliği).

export const QcOutput = z.object({
  identityKept: z.boolean(),
  styleApplied: z.boolean(),
  strayHairCleared: z.boolean(),
  artifacts: z.enum(["none", "minor", "major"]),
  reasons: z.array(z.enum(QC_REASONS)),
});
export type QcOutput = z.infer<typeof QcOutput>;

export const QC_JSON_SCHEMA = toAnthropicJsonSchema(QcOutput);
export const QC_MAX_TOKENS = 1_500;
export const QC_TIMEOUT_MS = 25_000;
export const QC_PROMPT_VERSION = "tryon-qc.v1";

/** Anthropic'in kabul ettiği görsel türleri; Gemini çıktısı png/jpeg gelir. */
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
export function toImageType(mime: string): ImageType {
  const m = mime.toLowerCase().split(";")[0].trim();
  return (IMAGE_TYPES as readonly string[]).includes(m) ? (m as ImageType) : "image/png";
}

export const QC_SYSTEM = `You are the quality gate of a virtual hair/beard try-on app. You receive two photos of the same person: image 1 is the ORIGINAL selfie, image 2 is the EDITED result, plus a description of what should have changed. Judge only the edit; never comment on the person's appearance, attractiveness, age, ethnicity or health.
Answer each field strictly:
- identityKept: the same person is clearly recognizable; face shape, bone structure, eyes, nose, lips, skin color and hairline are unchanged. False if the face looks like a different person, is slimmed/reshaped, or the skin color changed.
- styleApplied: the requested change is clearly visible and matches the description (hair cut/length/texture, beard shape, hair color, or the described skin-care changes).
- strayHairCleared: for beard edits, every area that the style describes as shaved (cheeks, sideburns, neck, chin or upper lip as applicable) is actually clean, with no leftover stubble patches or shadow. For hair-only or color-only edits, or if no beard area was supposed to be shaved, answer true.
- artifacts: none | minor (small blur or seam a user may not notice) | major (visible seams, melted/duplicated features, floating hair, distorted ears or jaw, text, extra limbs).
- reasons: list every applicable code: identity_changed, style_not_applied, stray_hair_left, artifacts (only when major), face_shape_changed, skin_over_smoothed (skin looks airbrushed/plastic, pores and moles gone), no_face, multiple_faces, unsafe_content. Empty when everything is fine.
Return only the JSON object.`;

export type QcRequest = {
  originalBase64: string;
  originalMime: string;
  resultBase64: string;
  resultMime: string;
  mode: TryonMode;
  /** Ne değişmeliydi (İngilizce, lib/ai/prompts/tryon.v2.ts describeExpectation). */
  expectation: string;
};

export type QcOutcome = {
  /** null: kontrol yapılamadı (kapalı, yapılandırma, hata) — reason dolu. */
  verdict: QcVerdict | null;
  reason?: string;
  model: string;
  usage: TokenUsage;
  usageByModel: ModelUsage[];
  estUsd: number;
  fallbackServed: boolean;
};

export interface QcProvider {
  readonly model: string;
  /** Hata fırlatmaz: başarısızlıkta verdict null ve reason dolu. */
  check(req: QcRequest, signal?: AbortSignal, timeoutMs?: number): Promise<QcOutcome>;
}

export function buildQcUserText(req: QcRequest): string {
  return `Mode: ${req.mode}. Expected change: ${req.expectation}\nImage 1 = original, image 2 = edited result. Evaluate image 2.`;
}

export class ClaudeQcProvider implements QcProvider {
  readonly model: string;
  private readonly env: AiEnv;
  private readonly cfg: TryonConfig;
  private readonly client?: Anthropic;

  constructor(opts: { env?: AiEnv; config?: TryonConfig; client?: Anthropic } = {}) {
    this.env = opts.env ?? getAiEnv();
    this.cfg = opts.config ?? getTryonConfig();
    this.model = this.cfg.qcModel;
    this.client = opts.client;
  }

  buildParams(req: QcRequest): MessageCreateParamsNonStreaming {
    const img = (data: string, mime: string): BetaImageBlockParam => ({ type: "image", source: { type: "base64", media_type: toImageType(mime), data } });
    const params: MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: QC_MAX_TOKENS,
      system: [{ type: "text", text: QC_SYSTEM, cache_control: { type: "ephemeral", ttl: this.env.cacheTtl } }],
      messages: [{ role: "user", content: [img(req.originalBase64, req.originalMime), img(req.resultBase64, req.resultMime), { type: "text", text: buildQcUserText(req) }] }],
      output_config: { effort: this.cfg.qcEffort, format: { type: "json_schema", schema: QC_JSON_SCHEMA } },
    };
    if (this.env.claudeFallbacks === "default") {
      params.betas = [SERVER_FALLBACK_BETA];
      params.fallbacks = "default";
    }
    return params;
  }

  async check(req: QcRequest, signal?: AbortSignal, timeoutMs = QC_TIMEOUT_MS): Promise<QcOutcome> {
    const empty = (reason: string): QcOutcome => ({ verdict: null, reason, model: this.model, usage: ZERO_USAGE, usageByModel: [], estUsd: 0, fallbackServed: false });
    let res: BetaMessage;
    try {
      const anthropic = this.client ?? getAnthropic();
      res = await anthropic.beta.messages.create(this.buildParams(req), { signal, timeout: timeoutMs });
    } catch (e) {
      if (e instanceof ApiError) return empty("config");
      console.warn(`[tryon-qc] claude hata: ${summarizeAnthropicError(e)}`);
      return empty(classifyAnthropicError(e, signal));
    }
    const usageByModel = readUsageByModel(res);
    const base = { model: res.model, usage: readUsage(res), usageByModel, estUsd: estUsdByModel(usageByModel), fallbackServed: servedByFallback(res) };
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
      console.warn(`[tryon-qc] claude ${res.stop_reason}`);
      return { ...base, verdict: null, reason: res.stop_reason };
    }
    const text = readJsonText(res).text;
    if (!text) return { ...base, verdict: null, reason: "schema" };
    try {
      const parsed = QcOutput.safeParse(JSON.parse(text));
      if (!parsed.success) return { ...base, verdict: null, reason: "schema" };
      return { ...base, verdict: toVerdict(parsed.data) };
    } catch {
      return { ...base, verdict: null, reason: "schema" };
    }
  }
}

/** Model çıktısı → QcVerdict; pass yalnız kodda (qcPass), tekrar eden nedenler tekilleşir. */
export function toVerdict(out: QcOutput): QcVerdict {
  const reasons = [...new Set(out.reasons)];
  const v = { identityKept: out.identityKept, styleApplied: out.styleApplied, strayHairCleared: out.strayHairCleared, artifacts: out.artifacts, reasons };
  return { ...v, pass: qcPass(v) };
}

/** TRYON_QC=off (yalnız geliştirme): kontrol yok, qc null. Üretimde açık. */
export function getQcProvider(cfg: TryonConfig = getTryonConfig()): QcProvider | null {
  return cfg.qc === "off" ? null : new ClaudeQcProvider({ config: cfg });
}
