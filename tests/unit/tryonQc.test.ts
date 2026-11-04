import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { SERVER_FALLBACK_BETA } from "@/lib/ai/observeProvider";
import { ClaudeQcProvider, QC_JSON_SCHEMA, QC_MAX_TOKENS, QC_SYSTEM, getQcProvider, toImageType, toVerdict, type QcOutcome, type QcOutput, type QcProvider, type QcRequest } from "@/lib/ai/tryonQc";
import type { TryonResult } from "@/lib/ai/tryonProvider";
import { getAiEnv } from "@/lib/config/ai.server";
import { getTryonConfig } from "@/lib/config/tryon";
import { generateWithQc } from "@/lib/tryon/pipeline.server";
import { qcPass, type QcVerdict } from "@/lib/tryon/types";

// Gerçek SDK, sahte fetch: ağ ve ücretli çağrı yok. Görsel yalnız bellekte; loglanmaz.
type Json = Record<string, unknown>;
const GOOD = { identityKept: true, styleApplied: true, strayHairCleared: true, artifacts: "minor" as const, reasons: [] as QcOutput["reasons"] };
const BAD = { identityKept: true, styleApplied: true, strayHairCleared: false, artifacts: "none", reasons: ["stray_hair_left", "stray_hair_left"] };

function message(text: string | null, over: Json = {}): Json {
  return {
    id: "msg_qc", type: "message", role: "assistant", model: "claude-opus-5-5",
    content: [{ type: "thinking", thinking: "", signature: "sig" }, ...(text === null ? [] : [{ type: "text", text, citations: null }])],
    stop_reason: "end_turn", stop_sequence: null, stop_details: null, container: null, context_management: null, diagnostics: null,
    usage: { input_tokens: 3000, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, iterations: null },
    ...over,
  };
}
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_qc" } });
function mocked(responses: (() => Response)[], env: Record<string, string> = {}) {
  const calls: { body: Json; headers: Headers }[] = [];
  let i = 0;
  const client = new Anthropic({
    apiKey: "k", maxRetries: 0,
    fetch: async (_u: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) as Json, headers: new Headers(init?.headers) });
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return r();
    },
  });
  return { p: new ClaudeQcProvider({ env: getAiEnv(env), config: getTryonConfig(env), client }), calls };
}
const req: QcRequest = { originalBase64: "AAAA", originalMime: "image/jpeg", resultBase64: "BBBB", resultMime: "image/png; charset=binary", mode: "combo", expectation: "Hair: buzz cut. Beard: Van Dyke." };

function walk(node: unknown, visit: (n: Json) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (typeof node !== "object" || node === null) return;
  visit(node as Json);
  for (const v of Object.values(node)) walk(v, visit);
}

describe("ClaudeQcProvider (KB R2-C10/3; CONTRACTS_V2 S2.6)", () => {
  it("istek: iki görsel + metin; küçük düz şema (hepsi zorunlu, min/max yok); temperature/thinking/tool_choice yok; efor low; sunucu yedeği", async () => {
    const { p, calls } = mocked([() => ok(message(JSON.stringify(GOOD)))]);
    const out = await p.check(req);
    expect(out.verdict).toEqual({ ...GOOD, pass: true });
    const body = calls[0].body;
    for (const k of ["temperature", "top_p", "top_k", "thinking", "tool_choice"]) expect(body).not.toHaveProperty(k);
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.max_tokens).toBe(QC_MAX_TOKENS);
    expect(body.system).toEqual([{ type: "text", text: QC_SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }]);
    const content = (body.messages as { content: Json[] }[])[0].content;
    expect(content.map((c) => c.type)).toEqual(["image", "image", "text"]);
    expect((content[0].source as Json).media_type).toBe("image/jpeg");
    expect((content[1].source as Json).media_type).toBe("image/png");
    expect(String(content[2].text)).toContain("Van Dyke");
    expect(body.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema: QC_JSON_SCHEMA } });
    expect(body.fallbacks).toBe("default");
    expect(calls[0].headers.get("anthropic-beta") ?? "").toContain(SERVER_FALLBACK_BETA);
    // Şema: 5 alan, hepsi zorunlu, enum korunur, sınır yok (grammar sınırı: küçük kalır)
    const props = QC_JSON_SCHEMA.properties as Json;
    expect(Object.keys(props).sort()).toEqual(["artifacts", "identityKept", "reasons", "strayHairCleared", "styleApplied"]);
    expect((QC_JSON_SCHEMA.required as string[]).length).toBe(5);
    expect((props.artifacts as Json).enum).toEqual(["none", "minor", "major"]);
    walk(QC_JSON_SCHEMA, (n) => {
      for (const k of ["minimum", "maximum", "minLength", "maxLength", "maxItems"]) expect(n).not.toHaveProperty(k);
    });
    expect(JSON.stringify(QC_JSON_SCHEMA).length).toBeLessThan(1500);
    expect(out.estUsd).toBeGreaterThan(0);
  });
  it("pass kodda türetilir: stil dışı kıl kaldıysa, kimlik gittiyse, büyük bozuklukta ya da yüz şekli değiştiyse geçmez; nedenler tekilleşir", async () => {
    const { p } = mocked([() => ok(message(JSON.stringify(BAD)))]);
    const out = await p.check(req);
    expect(out.verdict).toEqual({ identityKept: true, styleApplied: true, strayHairCleared: false, artifacts: "none", reasons: ["stray_hair_left"], pass: false });
    expect(toVerdict({ ...GOOD, artifacts: "major", reasons: ["artifacts"] }).pass).toBe(false);
    expect(toVerdict({ ...GOOD, identityKept: false, reasons: ["identity_changed"] }).pass).toBe(false);
    expect(toVerdict({ ...GOOD, reasons: ["face_shape_changed"] }).pass).toBe(false);
    expect(toVerdict({ ...GOOD, reasons: ["skin_over_smoothed"] }).pass).toBe(true); // yalnız bilgi; piksel kapısı ayrı
    expect(qcPass({ ...GOOD, artifacts: "minor", reasons: [] })).toBe(true);
  });
  it("refusal / max_tokens / bozuk JSON / şema dışı / HTTP hatası → verdict null, reason dolu; hata fırlatmaz", async () => {
    const cases: [() => Response, string][] = [
      [() => ok(message(null, { stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } })), "refusal"],
      [() => ok(message("{", { stop_reason: "max_tokens" })), "max_tokens"],
      [() => ok(message("{not json")), "schema"],
      [() => ok(message(JSON.stringify({ ...GOOD, artifacts: "huge" }))), "schema"],
      [() => ok({ type: "error", error: { type: "overloaded_error", message: "x" } }, 529), "transient"],
      [() => ok({ type: "error", error: { type: "invalid_request_error", message: "x" } }, 400), "fatal"],
    ];
    for (const [r, reason] of cases) {
      const { p } = mocked([r]);
      const out = await p.check(req);
      expect(out.verdict, reason).toBeNull();
      expect(out.reason, reason).toBe(reason);
    }
  });
  it("TRYON_QC=off → sağlayıcı yok; model/efor env'den", () => {
    expect(getQcProvider(getTryonConfig({ TRYON_QC: "off" }))).toBeNull();
    const p = getQcProvider(getTryonConfig({ TRYON_QC_MODEL: "claude-opus-5-5", TRYON_QC_EFFORT: "medium" }));
    expect(p?.model).toBe("claude-opus-5-5");
    expect(toImageType("image/webp")).toBe("image/webp");
    expect(toImageType("application/octet-stream")).toBe("image/png");
  });
});

// ── Üretim + kontrol döngüsü (sahte sağlayıcılar) ────────────────────────────────────────────────────────────────────
const img = (n: number): TryonResult => ({ imageBase64: `IMG${n}`, mimeType: "image/png" });
function fakeQc(verdicts: (Partial<QcVerdict> | null)[]): QcProvider & { calls: number } {
  const q = {
    model: "fake-qc",
    calls: 0,
    async check(): Promise<QcOutcome> {
      const v = verdicts[Math.min(q.calls, verdicts.length - 1)];
      q.calls++;
      const base = { model: "fake-qc", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, usageByModel: [], estUsd: 0.01, fallbackServed: false };
      if (v === null) return { ...base, verdict: null, reason: "transient" };
      const full = { identityKept: true, styleApplied: true, strayHairCleared: true, artifacts: "none" as const, reasons: [], ...v };
      return { ...base, verdict: { ...full, pass: qcPass(full) } };
    },
  };
  return q;
}
const qcReq = (r: TryonResult): QcRequest => ({ originalBase64: "O", originalMime: "image/jpeg", resultBase64: r.imageBase64, resultMime: r.mimeType, mode: "style", expectation: "x" });

describe("generateWithQc: en çok 2 yeniden üretim; geçmeyen görsel dönmez (Ç10)", () => {
  it("ilk denemede geçer: regen 0, görsel döner", async () => {
    let n = 0;
    const qc = fakeQc([{}]);
    const r = await generateWithQc({ generate: async () => img(++n), qc, qcRequest: qcReq, maxRegen: 2 });
    expect(r).toMatchObject({ outcome: "pass", regenCount: 0, result: { imageBase64: "IMG1" } });
    expect(r.verdict?.pass).toBe(true);
    expect(qc.calls).toBe(1);
    expect(r.qcEstUsd).toBeCloseTo(0.01);
  });
  it("kalır → yeniden üretir → geçer: regen 1, ikinci görsel döner", async () => {
    let n = 0;
    const qc = fakeQc([{ strayHairCleared: false, reasons: ["stray_hair_left"] }, {}]);
    const r = await generateWithQc({ generate: async () => img(++n), qc, qcRequest: qcReq, maxRegen: 2 });
    expect(r).toMatchObject({ outcome: "pass", regenCount: 1, result: { imageBase64: "IMG2" } });
    expect(n).toBe(2);
  });
  it("üç kez kalır → qc_failed: görsel null (asla gösterilmez), son karar ve regen 2; kota iadesi rotada status qc_failed", async () => {
    let n = 0;
    const qc = fakeQc([{ identityKept: false, reasons: ["identity_changed"] }]);
    const r = await generateWithQc({ generate: async () => img(++n), qc, qcRequest: qcReq, maxRegen: 2 });
    expect(r.outcome).toBe("qc_failed");
    expect(r.result).toBeNull();
    expect(r.regenCount).toBe(2);
    expect(n).toBe(3);
    expect(r.verdict?.reasons).toEqual(["identity_changed"]);
    expect(r.qcEstUsd).toBeCloseTo(0.03);
  });
  it("maxRegen 0 → tek üretim; süre bütçesi bittiyse yeniden üretim yok", async () => {
    let n = 0;
    const r0 = await generateWithQc({ generate: async () => img(++n), qc: fakeQc([{ styleApplied: false, reasons: ["style_not_applied"] }]), qcRequest: qcReq, maxRegen: 0 });
    expect(r0).toMatchObject({ outcome: "qc_failed", regenCount: 0 });
    expect(n).toBe(1);
    let t = 0;
    n = 0;
    const r = await generateWithQc({ generate: async () => img(++n), qc: fakeQc([{ styleApplied: false, reasons: ["style_not_applied"] }]), qcRequest: qcReq, maxRegen: 2, budgetMs: 500, now: () => (t += 700) });
    expect(r).toMatchObject({ outcome: "qc_failed", regenCount: 0 });
    expect(n).toBe(1);
  });
  it("kontrol kapalı ya da yapılamadı → unchecked: görsel döner, qc null (istemci sapma kontrolü yine çalışır)", async () => {
    const off = await generateWithQc({ generate: async () => img(1), qc: null, qcRequest: qcReq, maxRegen: 2 });
    expect(off).toMatchObject({ outcome: "unchecked", verdict: null, result: { imageBase64: "IMG1" } });
    const broken = await generateWithQc({ generate: async () => img(1), qc: fakeQc([null]), qcRequest: qcReq, maxRegen: 2 });
    expect(broken).toMatchObject({ outcome: "unchecked", verdict: null, qcReason: "transient", regenCount: 0 });
  });
  it("üretim hatası döngüden dışarı fırlar (rota status=failed yazar, kota iade)", async () => {
    await expect(generateWithQc({ generate: async () => { throw new Error("boom"); }, qc: fakeQc([{}]), qcRequest: qcReq, maxRegen: 2 })).rejects.toThrow("boom");
  });
});
