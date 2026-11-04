import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { classifyAnthropicError, getAnthropic, readJsonText, readUsage, servedByFallback, summarizeAnthropicError, toAnthropicJsonSchema } from "@/lib/ai/anthropic";
import { SERVER_FALLBACK_BETA } from "@/lib/ai/observeProvider";
import { ApiError } from "@/lib/api/errors";
import { getAiEnv, type AiEnv, type TokenUsage, ZERO_USAGE } from "@/lib/config/ai.server";
import { isFeatureEnabled } from "@/lib/config/flags";
import { DOCTOR_LAYER, PLAN_AREAS } from "@/lib/config/plan";
import type { KnowledgeSource, MethodRecord } from "@/lib/coach/knowledge";
import type { KnowledgeQuery } from "@/lib/coach/knowledge";
import { insertDraft } from "./queue";
import { DoctorItem, validateDoctorItems } from "./types";

// Doktor katmanı taslağı (KB Ç3/Ç5; PLAN 4f; AUP high-risk). Yalnız FEATURE_DOCTOR_LAYER açık + 18+ + tarama "ok" iken
// çağrılır; çıktı YALNIZ doctor_recommendations(status='draft') kuyruğuna yazılır, kullanıcıya hiçbir yoldan gitmez.
// Ayrı kanal: kullanıcı safety filtresi yerine Ç5 kuralları (doz/marka/satış yok, izinli alan adları) kodla uygulanır.

export const DOCTOR_PROMPT_VERSION = "doctor.v1";
export const DOCTOR_MAX_TOKENS = 4_000;

/** Küçük, düz şema: en çok iki öğe (kod kırpar); sayı/doz yok. */
export const DoctorDraftOutput = z.object({
  items: z.array(z.object({ methodId: z.string(), area: z.enum(PLAN_AREAS), rationale: z.string(), sources: z.array(z.string()) })),
});
export type DoctorDraftOutput = z.infer<typeof DoctorDraftOutput>;
export const DOCTOR_DRAFT_JSON_SCHEMA = toAnthropicJsonSchema(DoctorDraftOutput);

export const DOCTOR_SYSTEM = `Sen bir hekimin inceleyeceği TASLAK hazırlayan asistansın. Çıktın kullanıcıya doğrudan gitmez; bir hekim okur, değiştirir
ya da reddeder. Yalnız verilen listedeki yöntem kimliklerinden en çok iki öneri seç; her birine bir gerekçe yaz.
Kurallar: doz, miktar, kullanım sıklığı, marka, ürün adı, eczane, satış ya da fiyat bilgisi yazma. Kaynak olarak yalnız
bilimsel kaynak (DOI, PubMed, Cochrane, WHO) ya da TİTCK kullanma talimatı bağlantısı ver. Teşhis koyma; "bu konuda karar
muayenede hekimindir" dilini koru. Rakam yazma. Yalnız verilen JSON şemasına uygun çıktı üret.`;

export type DoctorDraftResult = { out: DoctorDraftOutput | null; reason?: string; usage: TokenUsage; model: string; fallbackServed: boolean };

export interface DoctorDraftProvider {
  readonly model: string;
  draft(userMessage: string, signal: AbortSignal, timeoutMs: number): Promise<DoctorDraftResult>;
}

export class ClaudeDoctorDraftProvider implements DoctorDraftProvider {
  readonly model: string;
  private readonly env: AiEnv;
  private readonly client?: Anthropic;
  constructor(opts: { env?: AiEnv; client?: Anthropic } = {}) {
    this.env = opts.env ?? getAiEnv();
    this.model = this.env.claudeCoachModel;
    this.client = opts.client;
  }
  buildParams(userMessage: string): MessageCreateParamsNonStreaming {
    const params: MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: DOCTOR_MAX_TOKENS,
      system: [{ type: "text", text: DOCTOR_SYSTEM, cache_control: { type: "ephemeral", ttl: this.env.cacheTtl } }],
      messages: [{ role: "user", content: userMessage }],
      output_config: { effort: this.env.claudeCoachEffort, format: { type: "json_schema", schema: DOCTOR_DRAFT_JSON_SCHEMA } },
    };
    if (this.env.claudeFallbacks === "default") {
      params.betas = [SERVER_FALLBACK_BETA];
      params.fallbacks = "default";
    }
    return params;
  }
  async draft(userMessage: string, signal: AbortSignal, timeoutMs: number): Promise<DoctorDraftResult> {
    const empty = (reason: string): DoctorDraftResult => ({ out: null, reason, usage: ZERO_USAGE, model: this.model, fallbackServed: false });
    let res: BetaMessage;
    try {
      const anthropic = this.client ?? getAnthropic();
      res = await anthropic.beta.messages.create(this.buildParams(userMessage), { signal, timeout: Math.max(1, timeoutMs) });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      console.warn(`[doctor] claude hata: ${summarizeAnthropicError(e)}`);
      return empty(classifyAnthropicError(e, signal));
    }
    const base = { usage: readUsage(res), model: res.model, fallbackServed: servedByFallback(res) };
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return { ...base, out: null, reason: res.stop_reason };
    const text = readJsonText(res).text;
    if (!text) return { ...base, out: null, reason: "schema" };
    try {
      const parsed = DoctorDraftOutput.safeParse(JSON.parse(text));
      return parsed.success ? { ...base, out: parsed.data } : { ...base, out: null, reason: "schema" };
    } catch {
      return { ...base, out: null, reason: "schema" };
    }
  }
}

export function buildDoctorUserMessage(i: { report: unknown; records: readonly MethodRecord[] }): string {
  return [
    `RAPOR (bölge bölge, nötr): ${JSON.stringify(i.report)}`,
    `YÖNTEM LİSTESİ (yalnız tier=doctor; id'leri birebir kullan): ${JSON.stringify(i.records.map((r) => ({ id: r.id, area: r.area, title: r.title, summary: r.summary, evidence: r.evidence.level })))}`,
    `Çıktı: yalnız JSON; en çok ${DOCTOR_LAYER.maxRecommendations} öğe.`,
  ].join("\n\n");
}

export type DraftArgs = {
  admin: SupabaseClient;
  userId: string;
  analysisId: string;
  reportId: string | null;
  report: unknown;
  under18: boolean;
  screen: "ok" | "risk" | null;
  knowledge: KnowledgeSource;
  query: KnowledgeQuery;
  provider?: DoctorDraftProvider;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * Taslak üretir ve KUYRUĞA yazar; döndürdüğü değer yalnız satır kimliğidir (içerik kullanıcıya gitmez). Kapı: flag açık,
 * 18+, tarama "ok", bilgi tabanında doctor katmanı kaydı var. Her kapı kapalıysa null ve hiçbir çağrı/yazma yok.
 */
export async function draftDoctorRecommendations(a: DraftArgs): Promise<{ id: string } | null> {
  if (!isFeatureEnabled("doctorLayer", a.env ?? process.env)) return null;
  if (a.under18 || a.screen !== "ok") return null;
  const records = (await a.knowledge.retrieve({ ...a.query, constraints: { ...a.query.constraints, doctorLayer: true } }, 40)).filter((r) => r.tier === "doctor");
  if (records.length === 0) return null;
  const provider = a.provider ?? new ClaudeDoctorDraftProvider();
  const res = await provider.draft(buildDoctorUserMessage({ report: a.report, records }), a.signal ?? new AbortController().signal, a.timeoutMs ?? 60_000);
  if (!res.out) return null;
  const parsedItems = res.out.items.map((it) => DoctorItem.safeParse(it)).flatMap((p) => (p.success ? [p.data] : []));
  const { valid } = validateDoctorItems(parsedItems, new Set(records.map((r) => r.id)));
  if (valid.length === 0) return null;
  const id = await insertDraft(a.admin, { user_id: a.userId, analysis_id: a.analysisId, report_id: a.reportId, ai_items: valid, ai_model: res.model, ai_prompt_version: DOCTOR_PROMPT_VERSION });
  return { id };
}
