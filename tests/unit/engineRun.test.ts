import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { assertEngineReady, estUsd } from "@/lib/config/ai.server";
import { ENGINE_STATUS, OBSERVE } from "@/lib/config/engine.server";
import { scoreHybrid, type AiUsage } from "@/lib/score/engine";
import { CTX, FakeProvider, GEO, IMG, REF_OBS, USAGE, fail, obs, ok } from "../helpers/engineFixtures";

type Settled = { value?: Awaited<ReturnType<typeof scoreHybrid>>; error?: unknown };

async function run(provider: FakeProvider, calls = 3, advanceMs = 60_000) {
  const usage: AiUsage[] = [];
  const p: Promise<Settled> = scoreHybrid(IMG, GEO, CTX, provider, { calls, onUsage: (u) => usage.push(u) }).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(advanceMs);
  return { ...(await p), usage };
}

const code = (e: unknown) => (e instanceof ApiError ? e.code : String(e));
const A = obs({ skin: { texture: "smooth" } });
const B = obs({ skin: { texture: "uneven" } });
const C = obs({ skin: { blemishes: "none" } });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("scoreHybrid orkestrasyonu (engine spec §2.5)", () => {
  it("3 farklı örnek → oylanmış skor; signals ve ai_usage dolu", async () => {
    const p = new FakeProvider([ok(A, 10), ok(B, 20), ok(C, 30)]);
    const r = await run(p);
    expect(r.error).toBeUndefined();
    expect(r.value!.samples).toBe(3);
    expect(r.value!.signals.samples).toMatchObject({ ok: 3, failed: 0, earlyStop: false, attempts: 3 });
    expect(r.value!.engineVersion).toBe("hybrid.v1");
    expect(r.value!.calibrationVersion).toBe("h1");
    expect(r.value!.model).toBe("claude-opus-5-5");
    expect(r.usage).toHaveLength(1);
    expect(r.usage[0]).toMatchObject({ calls: 3, attempts: 3, input: 3 * USAGE.input, output: 3 * USAGE.output, servedModels: ["claude-opus-5-5"] });
    expect(r.usage[0].estUsd).toBeGreaterThan(0);
  });

  it("erken durma: ilk iki örnek aynıysa üçüncü çağrı iptal edilir ve sonuç tam oyla aynı", async () => {
    const p = new FakeProvider([ok(A, 10), ok(A, 20), ok(B, 25_000)]);
    const r = await run(p, 3, 100);
    expect(r.value).toBeDefined();
    expect(p.signals[2].aborted).toBe(true);
    expect(r.value!.signals.samples.earlyStop).toBe(true);
    expect(r.value!.signals.obs.skin.texture).toBe("smooth");
  });

  it("yeter sayı: 1 başarı + 2 şema hatası → AI_FAILED; onUsage hatada da çağrılır", async () => {
    const r = await run(new FakeProvider([ok(A), fail("schema", 10, { usage: USAGE, model: "claude-opus-5-5" }), fail("schema")]));
    expect(code(r.error)).toBe("AI_FAILED");
    expect(r.usage).toHaveLength(1);
    expect(r.usage[0].input).toBe(2 * USAGE.input);
  });

  it("2 ret → AI_SAFETY_BLOCKED", async () => {
    const r = await run(new FakeProvider([fail("refusal"), fail("refusal"), ok(A)]));
    expect(code(r.error)).toBe("AI_SAFETY_BLOCKED");
  });

  it("tüm hatalar zaman aşımı/son tarih → AI_TIMEOUT", async () => {
    const r = await run(new FakeProvider([ok(A, 45_000)]), 3, 50_000);
    expect(code(r.error)).toBe("AI_TIMEOUT");
    expect(r.usage[0].attempts).toBe(3);
  });

  it("NO_FACE: başarıların en az yarısında tek yüz yok", async () => {
    const none = obs({ photo: { faceCount: "none" } });
    expect(code((await run(new FakeProvider([ok(none, 10), ok(REF_OBS, 20), ok(obs({ photo: { faceCount: "multiple" } }), 30)]))).error)).toBe("NO_FACE");
    const fine = await run(new FakeProvider([ok(none, 10), ok(A, 20), ok(B, 30)]));
    expect(fine.error).toBeUndefined();
  });

  it("geçici hata (408/409) bir kez yeniden denenir; ikinci hata yeniden denenmez", async () => {
    const p = new FakeProvider([fail("transient", 10, { status: 408 }), ok(A, 20), ok(B, 30), ok(C, 40), fail("transient", 10, { status: 409 })]);
    const r = await run(p);
    expect(r.value).toBeDefined();
    expect(p.calls).toBe(4);
    expect(r.value!.signals.samples.reasons).toEqual(["transient"]);
  });

  it("yeniden deneme yalnız ≥ 18 sn kaldıysa", async () => {
    // İlk deneme 25 sn sonra geçici hata: 15 sn kaldı → yeniden deneme yok.
    const p = new FakeProvider([fail("transient", 25_000), ok(A, 10), ok(B, 20)]);
    const r = await run(p);
    expect(p.calls).toBe(3);
    expect(r.value).toBeDefined();
    expect(OBSERVE.retryMinRemainingMs).toBe(18_000);
  });

  it("en çok 5 deneme", async () => {
    const p = new FakeProvider([fail("transient", 10)]);
    const r = await run(p);
    expect(p.calls).toBe(OBSERVE.maxAttempts);
    expect(code(r.error)).toBe("AI_FAILED");
    expect(r.usage[0].attempts).toBe(5);
  });

  it("413 kardeşleri iptal eder → IMAGE_TOO_LARGE", async () => {
    const p = new FakeProvider([fail("too_large", 10, { status: 413 }), ok(A, 5_000), ok(B, 5_000)]);
    const r = await run(p);
    expect(code(r.error)).toBe("IMAGE_TOO_LARGE");
    expect(p.signals[1].aborted).toBe(true);
    expect(p.signals[2].aborted).toBe(true);
  });

  it("ölümcül 400 kardeşleri iptal eder → AI_FAILED, yeniden deneme yok", async () => {
    const p = new FakeProvider([fail("fatal", 10, { status: 400 }), ok(A, 5_000), ok(B, 5_000)]);
    const r = await run(p);
    expect(code(r.error)).toBe("AI_FAILED");
    expect(p.calls).toBe(3);
    expect(p.signals.every((s) => s.aborted || s === p.signals[0])).toBe(true);
  });

  it("deneme zaman aşımı min(30 sn, kalan)", async () => {
    const p = new FakeProvider([ok(A, 10), ok(B, 20), ok(C, 30)]);
    await run(p);
    expect(p.timeouts.every((t) => t <= OBSERVE.attemptTimeoutMs)).toBe(true);
  });

  it("sunucu yedeği sunduysa scoring_model işaretlenir", async () => {
    const p = new FakeProvider([ok(A, 10, { fallbackServed: true, model: "claude-opus-5" }), ok(B, 20), ok(C, 30)]);
    const r = await run(p);
    expect(r.value!.model).toBe("claude-opus-5-5+fallback:claude-opus-5");
    expect(r.value!.signals.servedModels).toEqual(["claude-opus-5", "claude-opus-5-5"]);
    expect(r.value!.signals.samples.fallbackServed).toBe(1);
  });

  it("yedek zincirinde reddeden deneme ai_usage'a kendi modelinin fiyatıyla girer (başarı ve refusal)", async () => {
    const declined = { model: "claude-opus-5-5", usage: { input: 2000, output: 150, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } };
    const servedPart = { model: "claude-opus-5", usage: { input: 2000, output: 220, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } };
    const total = { input: 4000, output: 370, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
    const p = new FakeProvider([
      ok(A, 10, { fallbackServed: true, model: "claude-opus-5", usage: total, usageByModel: [declined, servedPart] }),
      ok(B, 20),
      fail("refusal", 30, { usage: total, usageByModel: [declined, { ...servedPart, model: "claude-opus-4-8" }], model: "claude-opus-4-8" }),
    ]);
    const r = await run(p);
    const u = r.usage[0];
    expect(u.input).toBe(USAGE.input + 2 * total.input);
    expect(u.output).toBe(USAGE.output + 2 * total.output);
    expect(u.servedModels).toEqual(["claude-opus-4-8", "claude-opus-5", "claude-opus-5-5"]);
    const expected =
      estUsd(USAGE, "claude-opus-5-5") + 2 * estUsd(declined.usage, "claude-opus-5-5") + estUsd(servedPart.usage, "claude-opus-5") + estUsd(servedPart.usage, "claude-opus-4-8");
    expect(u.estUsd).toBeCloseTo(expected, 5);
  });
});

describe("üretim koruması (engine spec §9.2)", () => {
  const prod = { VERCEL_ENV: "production", SCORE_ENGINE: "hybrid.v1" };
  it("ENGINE_STATUS provisional/pending iken üretimde fırlatır", () => {
    expect(() => assertEngineReady(prod, { status: ENGINE_STATUS })).toThrow("engine_not_ready");
  });
  it.each([
    ["norms", { norms: "provisional", categories: "fitted", legal: "approved" }],
    ["categories", { norms: "fitted", categories: "provisional", legal: "approved" }],
    ["legal", { norms: "fitted", categories: "fitted", legal: "pending" }],
  ] as const)("%s eksikse fırlatır; hepsi tamamsa geçer", (_k, status) => {
    expect(() => assertEngineReady(prod, { status })).toThrow("engine_not_ready");
    expect(() => assertEngineReady(prod, { status: { norms: "fitted", categories: "fitted", legal: "approved" } })).not.toThrow();
  });
  it("üretim dışında veya legacy motorda fırlatmaz", () => {
    expect(() => assertEngineReady({ VERCEL_ENV: "preview", SCORE_ENGINE: "hybrid.v1" }, { status: ENGINE_STATUS })).not.toThrow();
    expect(() => assertEngineReady({ VERCEL_ENV: "production", SCORE_ENGINE: "legacy" }, { status: ENGINE_STATUS })).not.toThrow();
  });
  it("scoreHybrid üretimde hazır değilken sağlayıcıyı hiç çağırmadan durur", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SCORE_ENGINE", "hybrid.v1");
    try {
      const p = new FakeProvider([ok(A)]);
      await expect(scoreHybrid(IMG, GEO, CTX, p)).rejects.toThrow("engine_not_ready");
      expect(p.calls).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
