import { describe, expect, it } from "vitest";
import { aiErrorSummary, isTransientAiError, withTransientRetry } from "@/lib/ai/retry";

const e503 = new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}');
const e429 = new Error('{"error":{"code":429,"message":"Resource has been exhausted","status":"RESOURCE_EXHAUSTED"}}');
const e400 = new Error('{"error":{"code":400,"message":"Invalid JSON payload","status":"INVALID_ARGUMENT"}}');

describe("AI geçici hata ve yeniden deneme", () => {
  it("503/429 geçici, 400 kalıcı", () => {
    expect(isTransientAiError(e503)).toBe(true);
    expect(isTransientAiError(e429)).toBe(true);
    expect(isTransientAiError(e400)).toBe(false);
    expect(isTransientAiError(new Error("fetch failed"))).toBe(false);
  });
  it("özet yalnız kod, durum ve kısa mesaj içerir", () => {
    const sum = aiErrorSummary(e503);
    expect(sum.startsWith("503 UNAVAILABLE This model is currently experiencing high demand")).toBe(true);
    expect(sum.length).toBeLessThanOrEqual(100);
    expect(aiErrorSummary(new Error("x".repeat(300))).length).toBe(120);
  });
  it("geçici hatada üstel bekleyip tekrar dener, sonunda başarır", async () => {
    const delays: number[] = [];
    let n = 0;
    const r = await withTransientRetry(
      async () => {
        n++;
        if (n < 3) throw e503;
        return "ok";
      },
      { retries: 2, baseDelayMs: 100, sleep: async (ms) => void delays.push(ms) },
    );
    expect(r).toBe("ok");
    expect(n).toBe(3);
    expect(delays).toEqual([100, 200]);
  });
  it("deneme hakkı bitince son hatayı fırlatır; kalıcı hatada hiç beklemez", async () => {
    let n = 0;
    await expect(withTransientRetry(async () => { n++; throw e503; }, { retries: 1, baseDelayMs: 1, sleep: async () => {} })).rejects.toBe(e503);
    expect(n).toBe(2);
    n = 0;
    await expect(withTransientRetry(async () => { n++; throw e400; }, { retries: 3, baseDelayMs: 1, sleep: async () => {} })).rejects.toBe(e400);
    expect(n).toBe(1);
  });
  it("iptal edilmiş sinyalde tekrar denemez", async () => {
    const c = new AbortController();
    c.abort();
    let n = 0;
    await expect(withTransientRetry(async () => { n++; throw e503; }, { retries: 3, baseDelayMs: 1, signal: c.signal, sleep: async () => {} })).rejects.toBe(e503);
    expect(n).toBe(1);
  });
  it("Anthropic durum kodları (ördek tiplemesi): 529/429/409/408/5xx geçici; 400/413 değil", () => {
    for (const status of [408, 409, 429, 500, 502, 503, 504, 529]) expect(isTransientAiError(Object.assign(new Error("x"), { status }))).toBe(true);
    for (const status of [400, 401, 402, 403, 404, 413, 422]) expect(isTransientAiError(Object.assign(new Error("x"), { status }))).toBe(false);
    expect(isTransientAiError({ status: 529 })).toBe(true);
    expect(isTransientAiError(new Error("529 overloaded_error"))).toBe(true);
    expect(isTransientAiError(new Error('{"type":"error","error":{"type":"overloaded_error"}}'))).toBe(true);
  });
  it("Anthropic özeti durum, tip ve istek kimliği; ≤ 100 karakter, ileti gövdesi yok", () => {
    const e = Object.assign(new Error("istem içeriği " + "y".repeat(300)), { status: 529, type: "overloaded_error", requestID: "req_011CAbc" });
    const sum = aiErrorSummary(e);
    expect(sum).toBe("529 overloaded_error req_011CAbc");
    expect(sum.length).toBeLessThanOrEqual(100);
    const nested = Object.assign(new Error("z".repeat(300)), { status: 400, error: { type: "error", error: { type: "invalid_request_error" } }, requestID: "r".repeat(200) });
    expect(aiErrorSummary(nested).length).toBeLessThanOrEqual(100);
    expect(aiErrorSummary(nested).startsWith("400 invalid_request_error ")).toBe(true);
  });
});
