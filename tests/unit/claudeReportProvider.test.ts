import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { SERVER_FALLBACK_BETA } from "@/lib/ai/observeProvider";
import { COACH, COACH_JSON_SCHEMA, ClaudeReportProvider, GeminiReportProvider, getReportProvider, type ReportProvider } from "@/lib/ai/provider";
import type { CoachReport } from "@/lib/ai/reportSchema";
import { ApiError } from "@/lib/api/errors";
import { estUsd, getAiEnv, type TokenUsage } from "@/lib/config/ai.server";
import { generateCoachReport, type ReportInput } from "@/lib/coach/generate";
import type { Questionnaire } from "@/lib/questionnaire";

// Gerçek SDK 1.3.0, sahte fetch (engine spec §11 #16). Ağ çağrısı ve ücretli istek yok.

type Json = Record<string, unknown>;

const REPORT: CoachReport = {
  summary: "Bu plan cilt ve saç bakımına odaklanır.",
  scoreNarrative: "Bakım alt skorların kodda hesaplandı; plan bu alanlara odaklanır.",
  hair: [],
  beard: [],
  hairColor: null,
  skincare: { morning: [{ stepType: "st_spf", note: "Her sabah." }], evening: [], weekly: [] },
  faceContours: { enabled: false, tips: [] },
  exercises: [],
  habits: [{ id: "hb_sleep", target: "7–9 saat" }],
  style: ["Sade üstler yüz hatlarını öne çıkarır."],
  linkedActions: { skin: ["st_spf"], hair: [], grooming: [], jawline: [] },
  seeProfessional: null,
};

function message(text: string | null, over: Json = {}, usageOver: Json = {}): Json {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "thinking", thinking: "", signature: "sig" }, ...(text === null ? [] : [{ type: "text", text, citations: null }])],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    diagnostics: null,
    usage: {
      input_tokens: 4500,
      output_tokens: 3000,
      cache_read_input_tokens: 1300,
      cache_creation_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
      iterations: null,
      ...usageOver,
    },
    ...over,
  };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_test123" } });

type Call = { body: Json; headers: Headers };

function mocked(responses: (() => Response)[], env: Record<string, string> = {}) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ body: JSON.parse(String(init?.body)) as Json, headers: new Headers(init?.headers) });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return r();
  };
  const client = new Anthropic({ apiKey: "test-key", maxRetries: 0, fetch: fetchImpl });
  return { p: new ClaudeReportProvider({ env: getAiEnv({ AI_COACH_PROVIDER: "claude", ...env }), client }), calls };
}

function usageSpy() {
  const seen: { u: TokenUsage; model: string; estUsd: number | null }[] = [];
  return { seen, onUsage: (u: TokenUsage, info: { model: string; estUsd: number | null }) => seen.push({ u, ...info }) };
}

function walk(node: unknown, visit: (n: Json) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (typeof node !== "object" || node === null) return;
  visit(node as Json);
  for (const v of Object.values(node)) walk(v, visit);
}

describe("ClaudeReportProvider isteği", () => {
  it("örnekleme parametresi, thinking, tool_choice ve ön doldurma yok; önbellekli sistem, efor ve JSON şeması var", async () => {
    const { p, calls } = mocked([() => jsonResponse(message(JSON.stringify(REPORT)))]);
    await p.generateReport("SİSTEM", "KULLANICI");
    const body = calls[0].body;
    for (const k of ["temperature", "top_p", "top_k", "thinking", "tool_choice"]) expect(body).not.toHaveProperty(k);
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.max_tokens).toBe(COACH.maxTokens);
    expect(body.system).toEqual([{ type: "text", text: "SİSTEM", cache_control: { type: "ephemeral", ttl: "1h" } }]);
    expect(body.messages).toEqual([{ role: "user", content: "KULLANICI" }]);
    expect(body.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema: COACH_JSON_SCHEMA } });
    // Varsayılan CLAUDE_FALLBACKS=default: sunucu taraflı yedek ve beta başlığı.
    expect(body.fallbacks).toBe("default");
    expect(calls[0].headers.get("anthropic-beta") ?? "").toContain(SERVER_FALLBACK_BETA);
  });
  it("CLAUDE_FALLBACKS=off iken fallbacks ve beta başlığı yok", async () => {
    const { p, calls } = mocked([() => jsonResponse(message(JSON.stringify(REPORT)))], { CLAUDE_FALLBACKS: "off", CLAUDE_COACH_EFFORT: "medium" });
    await p.generateReport("S", "U");
    expect(calls[0].body).not.toHaveProperty("fallbacks");
    expect(calls[0].headers.get("anthropic-beta") ?? "").not.toContain(SERVER_FALLBACK_BETA);
    expect((calls[0].body.output_config as Json).effort).toBe("medium");
  });
  it("giden şemada desteklenmeyen sınır yok; her nesne additionalProperties:false ve required taşır", () => {
    walk(COACH_JSON_SCHEMA, (n) => {
      for (const k of ["$schema", "minimum", "maximum", "minLength", "maxLength", "maxItems"]) expect(n).not.toHaveProperty(k);
      if (n.type === "object") {
        expect(n.additionalProperties).toBe(false);
        expect(Array.isArray(n.required)).toBe(true);
      }
    });
  });
});

describe("ClaudeReportProvider yanıtı", () => {
  it("geçerli yanıt: rapor ayrıştırılır, tokenlar toplanır, maliyet hesaplanır, onUsage bir kez", async () => {
    const { p } = mocked([() => jsonResponse(message(JSON.stringify(REPORT), {}, { cache_creation_input_tokens: 200, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 } }))]);
    const spy = usageSpy();
    const g = await p.generateReport("S", "U", undefined, { onUsage: spy.onUsage });
    expect(g.report).toEqual(REPORT);
    expect(g.inputTokens).toBe(4500 + 1300 + 200);
    expect(g.outputTokens).toBe(3000);
    const u = { input: 4500, output: 3000, cacheRead: 1300, cacheWrite5m: 0, cacheWrite1h: 200 };
    expect(g.estUsd).toBe(estUsd(u, "claude-opus-5-5"));
    expect(spy.seen).toEqual([{ u, model: "claude-opus-5-5", estUsd: g.estUsd }]);
    expect(g.fallbackServed).toBe(false);
  });
  it("refusal (kısmi metinle veya boş) ve max_tokens → report null, raw korunur; kullanım yine sayılır", async () => {
    const partial = JSON.stringify(REPORT).slice(0, 80);
    const cases = [
      message(partial, { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } }),
      message(null, { stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } }),
      message(partial, { stop_reason: "max_tokens" }),
      message(JSON.stringify(REPORT), { stop_reason: "max_tokens" }),
    ];
    for (const body of cases) {
      const { p } = mocked([() => jsonResponse(body)]);
      const spy = usageSpy();
      const g = await p.generateReport("S", "U", undefined, { onUsage: spy.onUsage });
      expect(g.report).toBeNull();
      const content = body.content as { type: string; text?: string }[];
      expect(g.raw).toBe(content.find((b) => b.type === "text")?.text ?? "");
      expect(spy.seen).toHaveLength(1);
      expect(spy.seen[0].u.output).toBe(3000);
    }
  });
  it("end_turn + bozuk JSON → report null", async () => {
    const { p } = mocked([() => jsonResponse(message("{bozuk"))]);
    const g = await p.generateReport("S", "U");
    expect(g.report).toBeNull();
    expect(g.raw).toBe("{bozuk");
  });
  it("sunucu taraflı yedek usage.iterations'tan algılanır; reddeden deneme de kendi fiyatıyla faturalanır", async () => {
    const iter = { input_tokens: 4500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null };
    const iterations = [
      { type: "message", model: "claude-opus-5-5", output_tokens: 400, ...iter },
      { type: "fallback_message", model: "claude-opus-5", output_tokens: 3000, ...iter },
    ];
    const { p } = mocked([
      () =>
        jsonResponse(
          message(JSON.stringify(REPORT), { model: "claude-opus-5" }, { input_tokens: 4500, output_tokens: 3000, cache_read_input_tokens: 0, iterations }),
        ),
    ]);
    const spy = usageSpy();
    const g = await p.generateReport("S", "U", undefined, { onUsage: spy.onUsage });
    expect(g.fallbackServed).toBe(true);
    expect(g.servedModel).toBe("claude-opus-5");
    const declined = estUsd({ input: 4500, output: 400, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, "claude-opus-5-5");
    const served = estUsd({ input: 4500, output: 3000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, "claude-opus-5");
    expect(g.estUsd).toBeCloseTo(declined + served, 6);
    expect(g.inputTokens).toBe(9000);
    expect(g.outputTokens).toBe(3400);
    expect(spy.seen[0].u).toEqual({ input: 9000, output: 3400, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
  });
  it("HTTP hatası → ApiError AI_FAILED, onUsage sıfır tokenla bir kez; zaman aşımı → AI_TIMEOUT", async () => {
    const { p } = mocked([() => jsonResponse({ type: "error", error: { type: "api_error", message: "x" } }, 500)]);
    const spy = usageSpy();
    const err = await p.generateReport("S", "U", undefined, { onUsage: spy.onUsage }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("AI_FAILED");
    expect(spy.seen).toEqual([{ u: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, model: "claude-opus-5-5", estUsd: 0 }]);

    const ac = new AbortController();
    ac.abort("deadline");
    const t = mocked([() => jsonResponse(message(JSON.stringify(REPORT)))]);
    const err2 = await t.p.generateReport("S", "U", ac.signal).catch((e: unknown) => e);
    expect((err2 as ApiError).code).toBe("AI_TIMEOUT");
  });
});

describe("getReportProvider", () => {
  it("AI_COACH_PROVIDER: varsayılan gemini, claude seçilebilir", () => {
    expect(getReportProvider(getAiEnv({}))).toBeInstanceOf(GeminiReportProvider);
    expect(getReportProvider(getAiEnv({ AI_COACH_PROVIDER: "claude" }))).toBeInstanceOf(ClaudeReportProvider);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

const q: Questionnaire = {
  goals: ["skin"],
  presentation: "male",
  hairType: "straight",
  hairLength: "short",
  beardPreference: "stubble",
  beardGrowth: "medium",
  skinType: "normal",
  budget: "medium",
  minutesPerDay: 10,
  glasses: false,
  headCovering: false,
  jawHealth: [],
};

const input: ReportInput = {
  overall: 5.5,
  potential: 6.5,
  subscores: { harmony: 5.5, eyes: 5.5, jawline: 5.5, skin: 5.5, hair: 5.5, grooming: 5.5 },
  gains: { skin: { value: 1, lever: "a" }, hair: { value: 0.5, lever: "b" }, grooming: { value: 0.5, lever: "c" }, jawline: { value: 0, lever: "" } },
  observations: { skin: "Doku pürüzsüz.", hair: "Saç düzenli.", brows: "Kaşlar düzenli.", facialHair: "Dudaklar nemli görünüyor." },
  flags: { visibleSkinConcern: false, skinConcernNote: null },
  faceShape: { primary: "oval", confidence: 0.8 },
  questionnaire: q,
};

describe("generateCoachReport kullanım toplamı (engine spec §9.6, C10)", () => {
  it("şema hatası + tekrar + güvenlik tekrarı: üç denemenin kullanımı toplanır", async () => {
    const unsafe = { ...REPORT, style: ["Botoks yaptırmayı düşünebilirsin."] };
    const { p, calls } = mocked([
      () => jsonResponse(message("{bozuk")),
      () => jsonResponse(message(JSON.stringify(unsafe))),
      () => jsonResponse(message(JSON.stringify(REPORT))),
    ]);
    const spy = usageSpy();
    const g = await generateCoachReport(input, p, { onUsage: spy.onUsage });
    expect(calls).toHaveLength(3);
    expect(g.isFallback).toBe(false);
    expect(g.safetyFlags).toEqual(["medical_procedure"]);
    expect(g.report.style).toEqual(REPORT.style);
    expect(g.promptVersion).toBe("report.v2");
    expect(spy.seen).toHaveLength(3);
    expect(g.aiUsage.attempts).toBe(3);
    expect(g.aiUsage.input).toBe(3 * 4500);
    expect(g.aiUsage.output).toBe(9000);
    expect(g.aiUsage.cacheRead).toBe(3 * 1300);
    const one = estUsd({ input: 4500, output: 3000, cacheRead: 1300, cacheWrite5m: 0, cacheWrite1h: 0 }, "claude-opus-5-5");
    expect(g.aiUsage.estUsd).toBeCloseTo(3 * one, 6);
    expect(g.inputTokens).toBe(3 * (4500 + 1300));
    expect(g.outputTokens).toBe(9000);
    expect(g.aiUsage.servedModels).toEqual(["claude-opus-5-5"]);
    // Güvenlik tekrarı sistem istemine uyarı ekler.
    expect(String((calls[2].body.system as { text: string }[])[0].text)).toContain("ÖNEMLİ: Önceki yanıtta");
  });
  it("fırlatılan denemeler de sayılır; ikisi de başarısızsa yedek rapor ve toplam kullanım", async () => {
    const { p, calls } = mocked([() => jsonResponse({ type: "error", error: { type: "overloaded_error", message: "x" } }, 529), () => jsonResponse(message("{bozuk"))]);
    const g = await generateCoachReport(input, p);
    expect(calls).toHaveLength(2);
    expect(g.isFallback).toBe(true);
    expect(g.aiUsage.attempts).toBe(2);
    expect(g.aiUsage.output).toBe(3000);
    expect(g.outputTokens).toBe(3000);
  });
  it("son tarihe 45 s'den az kaldıysa ikinci deneme yapılmaz; denemeye kalan süreye göre zaman aşımı verilir", async () => {
    let t = 0;
    const timeouts: (number | undefined)[] = [];
    const fake: ReportProvider = {
      model: "fake",
      async generateReport(_s, _u, _signal, opts) {
        timeouts.push(opts?.timeoutMs);
        opts?.onUsage?.({ input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, { model: "fake", estUsd: null });
        t += 70_000; // deneme 70 s sürdü
        return { report: null, raw: "", inputTokens: 1, outputTokens: 1 };
      },
    };
    const g = await generateCoachReport(input, fake, { now: () => t, deadlineAt: COACH.deadlineMs });
    expect(timeouts).toEqual([COACH.attemptTimeoutMs]);
    expect(g.isFallback).toBe(true);
    expect(g.aiUsage).toMatchObject({ attempts: 1, estUsd: null, servedModels: ["fake"] });
  });
  it("son tarihten çok önce başlayan denemenin zaman aşımı kalan süre − 5 s ile sınırlanır", async () => {
    const timeouts: (number | undefined)[] = [];
    const fake: ReportProvider = {
      model: "fake",
      async generateReport(_s, _u, _signal, opts) {
        timeouts.push(opts?.timeoutMs);
        return { report: REPORT, raw: JSON.stringify(REPORT), inputTokens: 1, outputTokens: 1 };
      },
    };
    const g = await generateCoachReport(input, fake, { now: () => 0, deadlineAt: 60_000 });
    expect(timeouts).toEqual([55_000]);
    expect(g.isFallback).toBe(false);
    expect(g.inputTokens).toBeNull(); // sağlayıcı onUsage çağırmadı
  });
});
