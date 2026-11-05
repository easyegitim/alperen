import "server-only";

import { ApiError } from "@/lib/api/errors";

// AI sağlayıcı ortamı, fiyatlar ve üretim koruması (engine spec §9.1, §9.2, §10; sözleşme C9).
// Yalnız sunucu: hiçbir değer NEXT_PUBLIC_ / EXPO_PUBLIC_ önekiyle istemciye gitmez. Gerçek anahtar burada veya
// .env.example'da yazılmaz; ANTHROPIC_API_KEY yalnız lib/ai/anthropic.ts içinde okunur.

const CLAUDE_EFFORTS = ["low", "medium", "high"] as const;
export type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number];

/** Boş dize "tanımlanmamış" sayılır; geçersiz değer koddaki varsayılana düşer (dağıtım davranış nötr kalır). */
function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}
function oneOf<T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T {
  const t = clean(v);
  return t !== undefined && (allowed as readonly string[]).includes(t) ? (t as T) : fallback;
}
function intIn(v: string | undefined, min: number, max: number, fallback: number): number {
  const t = clean(v);
  const n = t === undefined ? NaN : Number(t);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export type AiEnv = {
  /** hybrid.v2: Claude puan cetveli + ortanca-3 + kalibrasyon h2 (CONTRACTS_V2 §4; lib/config/engine.h2.server.ts). */
  scoreEngine: "hybrid.v1" | "hybrid.v2" | "legacy";
  observeProvider: "claude" | "gemini";
  coachProvider: "claude" | "gemini";
  claudeObserveModel: string;
  claudeObserveEffort: ClaudeEffort;
  claudeCoachModel: string;
  claudeCoachEffort: ClaudeEffort;
  /** hybrid.v2 puanlama çağrısı (tüm açılar tek mesajda; cetvel). Varsayılan efor medium (PLAN 3c). */
  claudeScoreModel: string;
  claudeScoreEffort: ClaudeEffort;
  /** hybrid.v2 denetim geçişi (Ek B dili + puan tutarlılığı); metin düzeltmesi için düşük efor yeter. */
  claudeAuditEffort: ClaudeEffort;
  /** "default": sunucu taraflı yedek model (beta server-side-fallback-2026-07-01). "off": tek model (adalet denetimi). */
  claudeFallbacks: "default" | "off";
  cacheTtl: "1h" | "5m";
  /** Analiz başına paralel gözlem çağrısı, 1–5. */
  observeCalls: number;
  geminiObserveModel: string;
};

type Env = Record<string, string | undefined>;

export function getAiEnv(env: Env = process.env): AiEnv {
  return {
    scoreEngine: oneOf(env.SCORE_ENGINE, ["hybrid.v1", "hybrid.v2", "legacy"], "legacy"),
    observeProvider: oneOf(env.AI_OBSERVE_PROVIDER, ["claude", "gemini"], "claude"),
    coachProvider: oneOf(env.AI_COACH_PROVIDER, ["claude", "gemini"], "gemini"),
    claudeObserveModel: clean(env.CLAUDE_OBSERVE_MODEL) ?? "claude-opus-5-5",
    claudeObserveEffort: oneOf(env.CLAUDE_OBSERVE_EFFORT, CLAUDE_EFFORTS, "low"),
    claudeCoachModel: clean(env.CLAUDE_COACH_MODEL) ?? "claude-opus-5-5",
    claudeCoachEffort: oneOf(env.CLAUDE_COACH_EFFORT, CLAUDE_EFFORTS, "low"),
    claudeScoreModel: clean(env.CLAUDE_SCORE_MODEL) ?? "claude-opus-5-5",
    claudeScoreEffort: oneOf(env.CLAUDE_SCORE_EFFORT, CLAUDE_EFFORTS, "medium"),
    claudeAuditEffort: oneOf(env.CLAUDE_AUDIT_EFFORT, CLAUDE_EFFORTS, "low"),
    claudeFallbacks: oneOf(env.CLAUDE_FALLBACKS, ["default", "off"], "default"),
    cacheTtl: oneOf(env.CLAUDE_CACHE_TTL, ["1h", "5m"], "1h"),
    observeCalls: intIn(env.OBSERVE_CALLS, 1, 5, 3),
    geminiObserveModel: clean(env.GEMINI_OBSERVE_MODEL) ?? "gemini-3.5-flash",
  };
}

/**
 * Gözlem çağrısının max_tokens değeri (engine spec §2.5 OBSERVE.maxTokens). Opus 5.5 düşünmeyi kapatmaya izin vermez:
 * yanıt, thinking parametresi gönderilmese de önce bir thinking bloğu taşır; bu yüzden ~200 tokenlık JSON'un üstünde
 * düşük efor düşünmesine pay bırakılır.
 */
export const OBSERVE_MAX_TOKENS = 4_096;

/** Bir çağrının token kullanımı. cacheWrite5m / cacheWrite1h: usage.cache_creation kırılımı. */
export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number };

export const ZERO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };

/** Tek bir modelin (sunucu taraflı yedek zincirinde bir halka) kullanımı; her halka kendi modelinin fiyatıyla sayılır. */
export type ModelUsage = { model: string; usage: TokenUsage };

export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  };
}

type Price = { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number };

/**
 * USD / milyon token (Anthropic birinci taraf API, 2026-10). Önbellek yazımı: 5 dk TTL = 1,25× girdi, 1 sa TTL = 2× girdi.
 * Opus 5.5 önbellek okuması 0,05× ($0,20); diğerleri 0,1×. Sunucu taraflı yedek bu modellerden birine düşebilir.
 */
export const AI_PRICING: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
};

/** Tabloda olmayan model için en pahalı bilinen fiyat: maliyet eksik değil, fazla tahmin edilir. */
const UNKNOWN_MODEL_PRICE: Price = Object.values(AI_PRICING).reduce((a, p) => ({
  input: Math.max(a.input, p.input),
  output: Math.max(a.output, p.output),
  cacheRead: Math.max(a.cacheRead, p.cacheRead),
  cacheWrite5m: Math.max(a.cacheWrite5m, p.cacheWrite5m),
  cacheWrite1h: Math.max(a.cacheWrite1h, p.cacheWrite1h),
}));

/** Tahmini maliyet (USD, 6 ondalık). Gerçek fatura Anthropic Console'dadır; bu değer ops.daily_ai_cost içindir. */
export function estUsd(u: TokenUsage, model: string): number {
  const p = AI_PRICING[model] ?? UNKNOWN_MODEL_PRICE;
  const usd =
    (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite5m * p.cacheWrite5m + u.cacheWrite1h * p.cacheWrite1h) /
    1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/** Model başına kullanımın toplam tahmini maliyeti (USD, 6 ondalık): her halka kendi modelinin fiyatıyla. */
export function estUsdByModel(parts: readonly ModelUsage[]): number {
  return Math.round(parts.reduce((s, p) => s + estUsd(p.usage, p.model), 0) * 1e6) / 1e6;
}

/** engine spec §9.2. Kaynak: lib/config/engine.server.ts ENGINE_STATUS (motor izi C). */
export type EngineStatus = {
  norms: "provisional" | "fitted";
  categories: "provisional" | "fitted";
  legal: "pending" | "approved";
};

/** Durum verilmezse en kapalı varsayım: üretimde açılmaz. */
const STATUS_UNKNOWN: EngineStatus = { norms: "provisional", categories: "provisional", legal: "pending" };

/**
 * Üretim koruması (engine spec §9.2). Yalnız VERCEL_ENV=production iken ve ilgili yol Claude/hybrid'e açıkken, normlar
 * veya kategoriler ölçülmemiş ya da hukuki onay yoksa fırlatır. Rota satırı failed yapar, AI_FAILED döner, hak iade edilir.
 */
export function assertEngineReady(
  env: Env = process.env,
  opts: { status?: EngineStatus; path?: "score" | "coach" } = {},
): void {
  if (env.VERCEL_ENV !== "production") return;
  const ai = getAiEnv(env);
  // Skor yolu: legacy dışındaki her motor (hybrid.v1 ve hybrid.v2) üretim kapısına tabidir (scoreEngineBlocked ile aynı).
  const active = (opts.path ?? "score") === "coach" ? ai.coachProvider === "claude" : ai.scoreEngine !== "legacy";
  if (!active) return;
  const s = opts.status ?? STATUS_UNKNOWN;
  if (s.norms !== "fitted" || s.categories !== "fitted" || s.legal !== "approved") {
    throw new ApiError("AI_FAILED", "engine_not_ready");
  }
}
