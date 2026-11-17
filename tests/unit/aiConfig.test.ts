import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { AI_PRICING, assertEngineReady, estUsd, getAiEnv, type EngineStatus } from "@/lib/config/ai.server";

// engine spec §9.1 (ortam), §9.2 (üretim koruması), §10 (fiyat). Saf; ağ yok.

describe("getAiEnv", () => {
  it("kod varsayılanları davranış nötr: legacy motor, Gemini koç, Claude gözlemci", () => {
    expect(getAiEnv({})).toEqual({
      scoreEngine: "legacy",
      observeProvider: "claude",
      coachProvider: "gemini",
      claudeObserveModel: "claude-opus-5-5",
      claudeObserveEffort: "low",
      claudeCoachModel: "claude-opus-5-5",
      claudeCoachEffort: "low",
      claudeScoreModel: "claude-opus-5-5",
      claudeScoreEffort: "medium",
      claudeAuditEffort: "low",
      claudeFallbacks: "default",
      cacheTtl: "1h",
      observeCalls: 3,
      geminiObserveModel: "gemini-3.5-flash",
    });
  });
  it("geçerli değerler okunur; geçersiz veya boş değer varsayılana düşer", () => {
    const e = getAiEnv({ SCORE_ENGINE: "hybrid.v1", AI_COACH_PROVIDER: "claude", CLAUDE_OBSERVE_EFFORT: "medium", CLAUDE_FALLBACKS: "off", CLAUDE_CACHE_TTL: "5m", OBSERVE_CALLS: "5" });
    expect(e.scoreEngine).toBe("hybrid.v1");
    expect(e.coachProvider).toBe("claude");
    expect(e.claudeObserveEffort).toBe("medium");
    expect(e.claudeFallbacks).toBe("off");
    expect(e.cacheTtl).toBe("5m");
    expect(e.observeCalls).toBe(5);
    expect(getAiEnv({ SCORE_ENGINE: "hybrid.v2", CLAUDE_SCORE_EFFORT: "high", CLAUDE_AUDIT_EFFORT: "medium" })).toMatchObject({ scoreEngine: "hybrid.v2", claudeScoreEffort: "high", claudeAuditEffort: "medium" });
    const bad = getAiEnv({ SCORE_ENGINE: "hybrid.v3", CLAUDE_OBSERVE_EFFORT: "max", OBSERVE_CALLS: "9", CLAUDE_OBSERVE_MODEL: "  ", CLAUDE_CACHE_TTL: "" });
    expect(bad.scoreEngine).toBe("legacy");
    expect(bad.claudeObserveEffort).toBe("low");
    expect(bad.observeCalls).toBe(3);
    expect(bad.claudeObserveModel).toBe("claude-opus-5-5");
    expect(bad.cacheTtl).toBe("1h");
    expect(getAiEnv({ OBSERVE_CALLS: "0" }).observeCalls).toBe(3);
    expect(getAiEnv({ OBSERVE_CALLS: "2.5" }).observeCalls).toBe(3);
  });
});

describe("estUsd / AI_PRICING", () => {
  it("Opus 5.5: $4 girdi, $20 çıktı, $0,20 önbellek okuma, $5 / $8 önbellek yazma (MTok)", () => {
    expect(AI_PRICING["claude-opus-5-5"]).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 });
    const M = 1_000_000;
    expect(estUsd({ input: M, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, "claude-opus-5-5")).toBe(4);
    expect(estUsd({ input: 0, output: M, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, "claude-opus-5-5")).toBe(20);
    expect(estUsd({ input: 0, output: 0, cacheRead: M, cacheWrite5m: M, cacheWrite1h: M }, "claude-opus-5-5")).toBeCloseTo(13.2, 6);
  });
  it("sıcak önbellekli gözlem çağrısı ≈ $0,0154 (§10)", () => {
    expect(estUsd({ input: 805, output: 600, cacheRead: 1150, cacheWrite5m: 0, cacheWrite1h: 0 }, "claude-opus-5-5")).toBeCloseTo(0.01545, 5);
  });
  it("bilinmeyen model en pahalı bilinen fiyatla sayılır (eksik tahmin yok)", () => {
    const u = { input: 1000, output: 1000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
    for (const m of Object.keys(AI_PRICING)) expect(estUsd(u, "bilinmeyen-model")).toBeGreaterThanOrEqual(estUsd(u, m));
  });
});

describe("assertEngineReady (§9.2)", () => {
  const ready: EngineStatus = { norms: "fitted", categories: "fitted", legal: "approved" };
  const prod = { VERCEL_ENV: "production", SCORE_ENGINE: "hybrid.v1" };
  const notReady = (f: () => void) => {
    try {
      f();
    } catch (e) {
      return e instanceof ApiError && e.code === "AI_FAILED" && e.message === "engine_not_ready";
    }
    return false;
  };

  it("üretimde hybrid.v1: üç alandan biri eksikse fırlatır", () => {
    expect(notReady(() => assertEngineReady(prod, { status: { ...ready, norms: "provisional" } }))).toBe(true);
    expect(notReady(() => assertEngineReady(prod, { status: { ...ready, categories: "provisional" } }))).toBe(true);
    expect(notReady(() => assertEngineReady(prod, { status: { ...ready, legal: "pending" } }))).toBe(true);
    expect(notReady(() => assertEngineReady(prod))).toBe(true);
    expect(() => assertEngineReady(prod, { status: ready })).not.toThrow();
  });
  it("üretim dışı veya legacy motorda fırlatmaz", () => {
    expect(() => assertEngineReady({ VERCEL_ENV: "preview", SCORE_ENGINE: "hybrid.v1" })).not.toThrow();
    expect(() => assertEngineReady({ SCORE_ENGINE: "hybrid.v1" })).not.toThrow();
    expect(() => assertEngineReady({ VERCEL_ENV: "production", SCORE_ENGINE: "legacy" })).not.toThrow();
  });
  it("koç yolu AI_COACH_PROVIDER=claude iken korunur", () => {
    const coach = { VERCEL_ENV: "production", AI_COACH_PROVIDER: "claude" };
    expect(notReady(() => assertEngineReady(coach, { path: "coach" }))).toBe(true);
    expect(() => assertEngineReady(coach, { path: "coach", status: ready })).not.toThrow();
    expect(() => assertEngineReady({ VERCEL_ENV: "production" }, { path: "coach" })).not.toThrow();
  });
});
